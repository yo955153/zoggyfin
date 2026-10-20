// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import CoreBluetooth
import Foundation

// The GATT UUIDs. They are the same as in `src/together/link-native-types.ts`.
private let bleServiceUUID = CBUUID(string: "FBB4EFE8-5E2A-49CF-A621-716EEDA1CB11")
private let bleInfoUUID = CBUUID(string: "FBB4EFE9-5E2A-49CF-A621-716EEDA1CB11")
private let bleRxUUID = CBUUID(string: "FBB4EFEA-5E2A-49CF-A621-716EEDA1CB11")
private let bleTxUUID = CBUUID(string: "FBB4EFEB-5E2A-49CF-A621-716EEDA1CB11")

/// The maximum size of one message (UTF-8 bytes).
private let bleMaxMessage = 4096
/// The maximum number of peers that the central connects to.
private let bleMaxPeers = 8
/// The time (seconds) that a lost peer has to come back before `onBlePeerLost`.
private let bleLostDelay: TimeInterval = 6

private func bleLog(_ text: String) {
  NSLog("[nearby-ble] %@", text)
}

/// Bluetooth LE rendezvous for iOS and macOS (CoreBluetooth only).
///
/// The host is the peripheral: it publishes the service and advertises it.
/// The guest is the central: it scans, connects to each host it finds, reads
/// INFO and subscribes to TX. Messages go in chunks (see the contract in
/// `link-native-types.ts`). All the state is on one serial queue. The events
/// go to the sink from that queue.
///
/// The managers are made only when they are necessary, because the first
/// manager shows the Bluetooth permission prompt.
public final class NearbyBle {
  private weak var sink: NearbyEventSink?
  private let queue = DispatchQueue(label: "zoggyfin.nearby-ble")
  private let queueKey = DispatchSpecificKey<Bool>()
  private var delegate: BleDelegate!

  private var central: CBCentralManager?
  private var peripheralManager: CBPeripheralManager?
  private var lastState: String?
  private var stateWaiters: [(String) -> Void] = []

  // Peripheral (host) state.
  private var wantAdvertise = false
  private var infoData = Data()
  private var localName = ""
  private var advertisedName: String?
  private var service: CBMutableService?
  private var serviceAdded = false
  private var addingService = false
  private var txChar: CBMutableCharacteristic?
  private var subscribers: [String: CBCentral] = [:]
  private var ignoredCentrals: Set<String> = []
  private var notifyQueue: [(peerId: String, data: Data)] = []

  // Central (guest) state.
  private var wantScan = false
  private var scanning = false
  private var peers: [String: BlePeer] = [:]
  private var lostTimers: [String: DispatchWorkItem] = [:]

  // Reassembly, one buffer for each peer and direction ("c:" or "p:" + peerId).
  private var inbox: [String: (next: Int, data: Data)] = [:]

  public init(sink: NearbyEventSink) {
    self.sink = sink
    queue.setSpecific(key: queueKey, value: true)
    delegate = BleDelegate(owner: self)
  }

  // MARK: - Public API

  /// Gives the Bluetooth state. It does not show the permission prompt.
  public func state(completion: @escaping (String) -> Void) {
    queue.async {
      if self.central != nil || self.peripheralManager != nil {
        self.waitForState(timeout: 3, completion: completion)
        return
      }
      switch CBManager.authorization {
      case .denied, .restricted:
        completion("unauthorized")
      case .notDetermined:
        completion("unknown")
      default:
        // Permission is given: a manager does not show a prompt now.
        self.ensureCentral()
        self.waitForState(timeout: 3, completion: completion)
      }
    }
  }

  /// Makes the central manager. The system shows the permission prompt if
  /// it is necessary. The completion gets the state after the user answers.
  public func requestPermission(completion: @escaping (String) -> Void) {
    queue.async {
      bleLog("request permission (authorization \(CBManager.authorization.rawValue))")
      self.ensureCentral()
      self.waitForState(timeout: 60, completion: completion)
    }
  }

  /// Host: publishes the service with this INFO text and advertises it.
  /// A second call changes INFO (and the local name).
  public func advertise(info: String, localName: String) {
    queue.async {
      self.infoData = Data(info.utf8)
      self.localName = localName
      self.wantAdvertise = true
      bleLog("advertise: info \(self.infoData.count) bytes, name \"\(localName)\"")
      self.ensurePeripheralManager()
      self.updatePeripheral()
    }
  }

  public func stopAdvertising() {
    queue.async {
      bleLog("stop advertising")
      self.wantAdvertise = false
      self.peripheralManager?.stopAdvertising()
      self.advertisedName = nil
    }
  }

  /// Guest: scans for hosts and connects to each host it finds.
  public func scan() {
    queue.async {
      bleLog("scan")
      self.wantScan = true
      self.ensureCentral()
      self.updateScan()
    }
  }

  /// Stops the scan. The open links stay.
  public func stopScan() {
    queue.async {
      bleLog("stop scan")
      self.wantScan = false
      self.updateScan()
    }
  }

  /// Sends one message to a peer (either role). Returns false if the peer
  /// has no ready link or the text is too long.
  public func send(peerId: String, text: String) -> Bool {
    let data = Data(text.utf8)
    if data.count > bleMaxMessage {
      bleLog("send to \(peerId): message too long (\(data.count) bytes)")
      return false
    }
    return onQueue { self.enqueue(peerId: peerId, data: data) }
  }

  /// Closes the link to a peer. A central link is cancelled. A peripheral
  /// cannot close a link, so it ignores that central until it subscribes again.
  public func disconnect(peerId: String) {
    queue.async {
      if let peer = self.peers[peerId] {
        bleLog("disconnect \(peerId) (central role)")
        let wasReady = peer.ready
        self.peers[peerId] = nil
        self.inbox["c:" + peerId] = nil
        self.central?.cancelPeripheralConnection(peer.peripheral)
        if wasReady { self.emit("onBleDisconnected", ["peerId": peerId]) }
      } else if self.subscribers[peerId] != nil {
        bleLog("disconnect \(peerId) (peripheral role): ignore it until it subscribes again")
        self.subscribers[peerId] = nil
        self.ignoredCentrals.insert(peerId)
        self.inbox["p:" + peerId] = nil
        self.notifyQueue.removeAll { $0.peerId == peerId }
        self.emit("onBleDisconnected", ["peerId": peerId])
      }
    }
  }

  /// Stops advertising and scanning and closes every link. It emits no events.
  public func stopAll() {
    queue.async {
      bleLog("stop all")
      self.wantAdvertise = false
      self.wantScan = false
      if let pm = self.peripheralManager {
        pm.stopAdvertising()
        pm.removeAllServices()
      }
      self.advertisedName = nil
      self.service = nil
      self.txChar = nil
      self.serviceAdded = false
      self.addingService = false
      self.subscribers.removeAll()
      self.ignoredCentrals.removeAll()
      self.notifyQueue.removeAll()
      if let c = self.central {
        if self.scanning, c.state == .poweredOn { c.stopScan() }
        let list = self.peers.values.map { $0.peripheral }
        self.peers.removeAll()
        for p in list { c.cancelPeripheralConnection(p) }
      }
      self.scanning = false
      self.peers.removeAll()
      for t in self.lostTimers.values { t.cancel() }
      self.lostTimers.removeAll()
      self.inbox.removeAll()
    }
  }

  // MARK: - State

  private func onQueue<T>(_ body: () -> T) -> T {
    if DispatchQueue.getSpecific(key: queueKey) == true { return body() }
    return queue.sync(execute: body)
  }

  private func emit(_ name: String, _ body: [String: Any]) {
    sink?.emit(name, body)
  }

  private func ensureCentral() {
    if central != nil { return }
    bleLog("make central manager")
    central = CBCentralManager(delegate: delegate, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: false])
  }

  private func ensurePeripheralManager() {
    if peripheralManager != nil { return }
    bleLog("make peripheral manager")
    peripheralManager = CBPeripheralManager(delegate: delegate, queue: queue, options: [CBPeripheralManagerOptionShowPowerAlertKey: false])
  }

  private static func map(_ s: CBManagerState) -> String? {
    switch s {
    case .poweredOn: return "on"
    case .poweredOff: return "off"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .unknown, .resetting: return nil
    @unknown default: return "unknown"
    }
  }

  /// The state of the managers. Nil while the managers do not know it yet.
  private func knownState() -> String? {
    if let c = central, let s = NearbyBle.map(c.state) { return s }
    if let p = peripheralManager, let s = NearbyBle.map(p.state) { return s }
    return nil
  }

  private func waitForState(timeout: TimeInterval, completion: @escaping (String) -> Void) {
    if let s = knownState() {
      completion(s)
      return
    }
    var done = false
    let once: (String) -> Void = { s in
      if done { return }
      done = true
      completion(s)
    }
    stateWaiters.append(once)
    queue.asyncAfter(deadline: .now() + timeout) {
      once(self.knownState() ?? "unknown")
    }
  }

  fileprivate func managerStateChanged() {
    let s = knownState() ?? "unknown"
    if knownState() != nil {
      let waiters = stateWaiters
      stateWaiters.removeAll()
      for w in waiters { w(s) }
    }
    if s != lastState {
      lastState = s
      bleLog("state \(s)")
      emit("onBleState", ["state": s])
    }
  }

  // MARK: - Peripheral (host)

  fileprivate func peripheralStateChanged(_ pm: CBPeripheralManager) {
    bleLog("peripheral manager state \(pm.state.rawValue)")
    if pm.state != .poweredOn {
      // The system removes the published services when Bluetooth goes off.
      serviceAdded = false
      addingService = false
      service = nil
      txChar = nil
      advertisedName = nil
      notifyQueue.removeAll()
      let lost = Array(subscribers.keys)
      subscribers.removeAll()
      for id in lost {
        inbox["p:" + id] = nil
        emit("onBleDisconnected", ["peerId": id])
      }
    }
    managerStateChanged()
    updatePeripheral()
  }

  private func updatePeripheral() {
    guard let pm = peripheralManager, pm.state == .poweredOn, wantAdvertise else { return }
    if !serviceAdded {
      if addingService { return }
      let info = CBMutableCharacteristic(type: bleInfoUUID, properties: [.read], value: nil, permissions: [.readable])
      let rx = CBMutableCharacteristic(type: bleRxUUID, properties: [.write], value: nil, permissions: [.writeable])
      let tx = CBMutableCharacteristic(type: bleTxUUID, properties: [.notify], value: nil, permissions: [.readable])
      let svc = CBMutableService(type: bleServiceUUID, primary: true)
      svc.characteristics = [info, rx, tx]
      service = svc
      txChar = tx
      addingService = true
      bleLog("add service")
      pm.add(svc)
      return
    }
    if pm.isAdvertising, advertisedName == localName { return }
    if pm.isAdvertising { pm.stopAdvertising() }
    advertisedName = localName
    var data: [String: Any] = [CBAdvertisementDataServiceUUIDsKey: [bleServiceUUID]]
    if !localName.isEmpty { data[CBAdvertisementDataLocalNameKey] = localName }
    bleLog("start advertising \"\(localName)\"")
    pm.startAdvertising(data)
  }

  fileprivate func serviceDidAdd(error: Error?) {
    addingService = false
    if let error {
      bleLog("add service failed: \(error.localizedDescription)")
      service = nil
      txChar = nil
      return
    }
    bleLog("service added")
    serviceAdded = true
    updatePeripheral()
  }

  fileprivate func advertisingDidStart(error: Error?) {
    if let error {
      bleLog("advertising failed: \(error.localizedDescription)")
      advertisedName = nil
    } else {
      bleLog("advertising started")
    }
  }

  fileprivate func didReceiveRead(_ pm: CBPeripheralManager, _ request: CBATTRequest) {
    guard request.characteristic.uuid == bleInfoUUID else {
      pm.respond(to: request, withResult: .requestNotSupported)
      return
    }
    let offset = request.offset
    if offset > infoData.count {
      bleLog("info read from \(request.central.identifier.uuidString): bad offset \(offset)")
      pm.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = infoData.subdata(in: offset..<infoData.count)
    bleLog("info read from \(request.central.identifier.uuidString): offset \(offset), \(infoData.count - offset) bytes")
    pm.respond(to: request, withResult: .success)
  }

  fileprivate func didReceiveWrite(_ pm: CBPeripheralManager, _ requests: [CBATTRequest]) {
    guard let first = requests.first else { return }
    if requests.contains(where: { $0.characteristic.uuid != bleRxUUID }) {
      pm.respond(to: first, withResult: .writeNotPermitted)
      return
    }
    // Apple: one response for the first request answers all of them. A long
    // write comes as parts with offsets; join the parts of each central.
    var order: [String] = []
    var parts: [String: [(Int, Data)]] = [:]
    for r in requests {
      let id = r.central.identifier.uuidString
      if parts[id] == nil { order.append(id) }
      parts[id, default: []].append((r.offset, r.value ?? Data()))
    }
    pm.respond(to: first, withResult: .success)
    for id in order {
      let chunk = parts[id]!.sorted { $0.0 < $1.0 }.reduce(into: Data()) { $0.append($1.1) }
      if ignoredCentrals.contains(id) {
        bleLog("rx chunk from ignored central \(id): dropped")
        continue
      }
      receiveChunk(key: "p:" + id, peerId: id, chunk: chunk)
    }
  }

  fileprivate func didSubscribe(_ pm: CBPeripheralManager, _ c: CBCentral, _ ch: CBCharacteristic) {
    guard ch.uuid == bleTxUUID else { return }
    let id = c.identifier.uuidString
    ignoredCentrals.remove(id)
    subscribers[id] = c
    pm.setDesiredConnectionLatency(.low, for: c)
    bleLog("central \(id) subscribed to TX (max update \(c.maximumUpdateValueLength))")
    emit("onBleConnected", ["peerId": id, "role": "peripheral"])
  }

  fileprivate func didUnsubscribe(_ c: CBCentral, _ ch: CBCharacteristic) {
    guard ch.uuid == bleTxUUID else { return }
    let id = c.identifier.uuidString
    ignoredCentrals.remove(id)
    inbox["p:" + id] = nil
    notifyQueue.removeAll { $0.peerId == id }
    if subscribers.removeValue(forKey: id) != nil {
      bleLog("central \(id) unsubscribed from TX")
      emit("onBleDisconnected", ["peerId": id])
    }
  }

  fileprivate func pumpNotify() {
    guard let pm = peripheralManager, let tx = txChar else {
      notifyQueue.removeAll()
      return
    }
    while let item = notifyQueue.first {
      guard let c = subscribers[item.peerId] else {
        notifyQueue.removeFirst()
        continue
      }
      if !pm.updateValue(item.data, for: tx, onSubscribedCentrals: [c]) {
        bleLog("tx queue full; wait for ready (\(notifyQueue.count) chunks left)")
        return
      }
      bleLog("tx chunk sent to \(item.peerId): \(item.data.count) bytes, header \(item.data.first ?? 0)")
      notifyQueue.removeFirst()
    }
  }

  // MARK: - Central (guest)

  fileprivate func centralStateChanged(_ c: CBCentralManager) {
    bleLog("central manager state \(c.state.rawValue)")
    if c.state != .poweredOn {
      scanning = false
      let list = peers
      peers.removeAll()
      for (id, peer) in list {
        inbox["c:" + id] = nil
        if peer.ready { emit("onBleDisconnected", ["peerId": id]) }
        if peer.reported { emit("onBlePeerLost", ["peerId": id]) }
      }
    }
    managerStateChanged()
    updateScan()
  }

  private func updateScan() {
    guard let c = central else { return }
    if wantScan, c.state == .poweredOn {
      if scanning { return }
      scanning = true
      bleLog("start scanning")
      c.scanForPeripherals(withServices: [bleServiceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    } else if scanning {
      scanning = false
      if c.state == .poweredOn { c.stopScan() }
      bleLog("scanning stopped")
    }
  }

  /// Starts the scan again, so that the system reports a peer again.
  private func restartScan() {
    guard let c = central, scanning, c.state == .poweredOn else { return }
    c.stopScan()
    c.scanForPeripherals(withServices: [bleServiceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
  }

  fileprivate func didDiscover(_ c: CBCentralManager, _ p: CBPeripheral, _ ad: [String: Any], _ rssi: NSNumber) {
    let id = p.identifier.uuidString
    if let peer = peers[id] {
      peer.rssi = rssi.intValue
      return
    }
    if peers.count >= bleMaxPeers {
      bleLog("found \(id), but already \(bleMaxPeers) peers: ignored")
      return
    }
    let name = (ad[CBAdvertisementDataLocalNameKey] as? String) ?? p.name ?? "?"
    bleLog("found \(id) \"\(name)\" rssi \(rssi.intValue); connect")
    let peer = BlePeer(peripheral: p, rssi: rssi.intValue)
    peers[id] = peer
    p.delegate = delegate
    c.connect(p, options: nil)
  }

  fileprivate func didConnect(_ p: CBPeripheral) {
    let id = p.identifier.uuidString
    guard peers[id] != nil else { return }
    if let t = lostTimers.removeValue(forKey: id) { t.cancel() }
    bleLog("connected \(id) (max write \(p.maximumWriteValueLength(for: .withoutResponse)) / \(p.maximumWriteValueLength(for: .withResponse)))")
    p.discoverServices([bleServiceUUID])
  }

  fileprivate func didFailToConnect(_ p: CBPeripheral, _ error: Error?) {
    let id = p.identifier.uuidString
    bleLog("connect to \(id) failed: \(error?.localizedDescription ?? "no error")")
    linkLost(id)
  }

  fileprivate func didDisconnect(_ p: CBPeripheral, _ error: Error?) {
    let id = p.identifier.uuidString
    bleLog("disconnected \(id): \(error?.localizedDescription ?? "no error")")
    linkLost(id)
  }

  /// The link to a peer is gone. If the peer does not come back in a short
  /// time, `onBlePeerLost` follows.
  private func linkLost(_ id: String) {
    guard let peer = peers.removeValue(forKey: id) else { return }
    inbox["c:" + id] = nil
    if peer.ready { emit("onBleDisconnected", ["peerId": id]) }
    if peer.reported {
      lostTimers[id]?.cancel()
      let work = DispatchWorkItem { [weak self] in
        guard let self else { return }
        self.lostTimers[id] = nil
        if self.peers[id]?.reported == true { return }
        bleLog("peer \(id) lost")
        self.emit("onBlePeerLost", ["peerId": id])
      }
      lostTimers[id] = work
      queue.asyncAfter(deadline: .now() + bleLostDelay, execute: work)
    }
    restartScan()
  }

  private func fail(_ p: CBPeripheral, _ step: String, _ error: Error?) {
    bleLog("\(p.identifier.uuidString): \(step) failed: \(error?.localizedDescription ?? "not found")")
    central?.cancelPeripheralConnection(p)
  }

  fileprivate func didDiscoverServices(_ p: CBPeripheral, _ error: Error?) {
    guard peers[p.identifier.uuidString] != nil else { return }
    guard error == nil, let svc = p.services?.first(where: { $0.uuid == bleServiceUUID }) else {
      fail(p, "discover services", error)
      return
    }
    p.discoverCharacteristics([bleInfoUUID, bleRxUUID, bleTxUUID], for: svc)
  }

  fileprivate func didDiscoverCharacteristics(_ p: CBPeripheral, _ svc: CBService, _ error: Error?) {
    guard let peer = peers[p.identifier.uuidString] else { return }
    let chars = svc.characteristics ?? []
    guard error == nil,
      let info = chars.first(where: { $0.uuid == bleInfoUUID }),
      let rx = chars.first(where: { $0.uuid == bleRxUUID }),
      let tx = chars.first(where: { $0.uuid == bleTxUUID })
    else {
      fail(p, "discover characteristics", error)
      return
    }
    peer.rx = rx
    peer.tx = tx
    bleLog("\(p.identifier.uuidString): characteristics found; read INFO")
    p.readValue(for: info)
  }

  fileprivate func didUpdateValue(_ p: CBPeripheral, _ ch: CBCharacteristic, _ error: Error?) {
    let id = p.identifier.uuidString
    guard let peer = peers[id] else { return }
    if ch.uuid == bleInfoUUID {
      guard error == nil, let data = ch.value, let text = String(data: data, encoding: .utf8) else {
        fail(p, "read INFO", error)
        return
      }
      bleLog("\(id): INFO read, \(data.count) bytes; subscribe to TX")
      peer.info = text
      if let tx = peer.tx { p.setNotifyValue(true, for: tx) }
    } else if ch.uuid == bleTxUUID {
      if let error {
        bleLog("\(id): TX value error: \(error.localizedDescription)")
        return
      }
      guard let data = ch.value else { return }
      receiveChunk(key: "c:" + id, peerId: id, chunk: data)
    }
  }

  fileprivate func didUpdateNotificationState(_ p: CBPeripheral, _ ch: CBCharacteristic, _ error: Error?) {
    let id = p.identifier.uuidString
    guard let peer = peers[id], ch.uuid == bleTxUUID else { return }
    guard error == nil, ch.isNotifying else {
      fail(p, "subscribe to TX", error)
      return
    }
    if peer.ready { return }
    peer.ready = true
    peer.reported = true
    if let t = lostTimers.removeValue(forKey: id) { t.cancel() }
    bleLog("\(id): subscribed to TX; link ready (chunk \(chunkSize(peerId: id) ?? 0) bytes)")
    emit("onBlePeer", ["peerId": id, "info": peer.info ?? "", "rssi": peer.rssi])
    emit("onBleConnected", ["peerId": id, "role": "central"])
  }

  fileprivate func didWrite(_ p: CBPeripheral, _ ch: CBCharacteristic, _ error: Error?) {
    let id = p.identifier.uuidString
    guard let peer = peers[id], ch.uuid == bleRxUUID else { return }
    peer.writing = false
    if let error {
      bleLog("\(id): rx write failed: \(error.localizedDescription); drop \(peer.writeQueue.count) queued chunks")
      peer.writeQueue.removeAll()
      return
    }
    pumpWrite(peer)
  }

  private func pumpWrite(_ peer: BlePeer) {
    guard !peer.writing, let rx = peer.rx, let chunk = peer.writeQueue.first else { return }
    peer.writeQueue.removeFirst()
    peer.writing = true
    bleLog("\(peer.peripheral.identifier.uuidString): rx chunk sent, \(chunk.count) bytes, header \(chunk.first ?? 0)")
    peer.peripheral.writeValue(chunk, for: rx, type: .withResponse)
  }

  // MARK: - Chunks

  /// The payload size of one chunk (the header byte is not in it).
  private func chunkSize(peerId: String) -> Int? {
    if let peer = peers[peerId], peer.ready {
      // ATT MTU - 3: the length of one write with no long (prepared) write.
      return max(1, peer.peripheral.maximumWriteValueLength(for: .withoutResponse) - 1)
    }
    if let c = subscribers[peerId] {
      return max(1, c.maximumUpdateValueLength - 1)
    }
    return nil
  }

  private func enqueue(peerId: String, data: Data) -> Bool {
    guard let size = chunkSize(peerId: peerId) else {
      bleLog("send to \(peerId): no ready link")
      return false
    }
    var chunks: [Data] = []
    var offset = 0
    var index = 0
    repeat {
      let end = min(offset + size, data.count)
      var chunk = Data([UInt8(index & 0x7F) | (end == data.count ? 0x80 : 0)])
      chunk.append(data.subdata(in: offset..<end))
      chunks.append(chunk)
      offset = end
      index += 1
    } while offset < data.count
    bleLog("send to \(peerId): message \(data.count) bytes in \(chunks.count) chunks of \(size)")
    if let peer = peers[peerId] {
      peer.writeQueue.append(contentsOf: chunks)
      pumpWrite(peer)
    } else {
      notifyQueue.append(contentsOf: chunks.map { (peerId: peerId, data: $0) })
      pumpNotify()
    }
    return true
  }

  private func receiveChunk(key: String, peerId: String, chunk: Data) {
    guard let header = chunk.first else {
      bleLog("chunk from \(peerId): empty; dropped")
      return
    }
    let index = Int(header & 0x7F)
    let last = header & 0x80 != 0
    let payload = chunk.dropFirst()
    bleLog("chunk received from \(peerId): \(chunk.count) bytes, index \(index)\(last ? ", last" : "")")
    var buffer: (next: Int, data: Data)
    if index == 0 {
      if inbox[key] != nil { bleLog("chunk from \(peerId): new message before the last chunk; old part dropped") }
      buffer = (next: 0, data: Data())
    } else if let b = inbox[key], b.next == index {
      buffer = b
    } else {
      bleLog("chunk from \(peerId): gap (index \(index)); message dropped")
      inbox[key] = nil
      return
    }
    buffer.data.append(payload)
    buffer.next = (index + 1) & 0x7F
    if buffer.data.count > bleMaxMessage {
      bleLog("chunk from \(peerId): message too long; dropped")
      inbox[key] = nil
      return
    }
    if !last {
      inbox[key] = buffer
      return
    }
    inbox[key] = nil
    guard let text = String(data: buffer.data, encoding: .utf8) else {
      bleLog("message from \(peerId): not UTF-8; dropped")
      return
    }
    bleLog("message received from \(peerId): \(buffer.data.count) bytes")
    emit("onBleMessage", ["peerId": peerId, "text": text])
  }
}

/// The state of one host that the central connects to.
private final class BlePeer {
  let peripheral: CBPeripheral
  var rssi: Int
  var info: String?
  var rx: CBCharacteristic?
  var tx: CBCharacteristic?
  /// The TX subscription is active (`onBleConnected` was sent).
  var ready = false
  /// `onBlePeer` was sent.
  var reported = false
  var writing = false
  var writeQueue: [Data] = []

  init(peripheral: CBPeripheral, rssi: Int) {
    self.peripheral = peripheral
    self.rssi = rssi
  }
}

/// Receives the CoreBluetooth callbacks (on the queue of `NearbyBle`) and
/// gives them to the owner. It keeps the delegate methods out of the public API.
private final class BleDelegate: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate {
  weak var owner: NearbyBle?

  init(owner: NearbyBle) {
    self.owner = owner
  }

  // Central manager
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    owner?.centralStateChanged(central)
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    owner?.didDiscover(central, peripheral, advertisementData, RSSI)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    owner?.didConnect(peripheral)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    owner?.didFailToConnect(peripheral, error)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    owner?.didDisconnect(peripheral, error)
  }

  // Peripheral (remote, central role)
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    owner?.didDiscoverServices(peripheral, error)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    owner?.didDiscoverCharacteristics(peripheral, service, error)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    owner?.didUpdateValue(peripheral, characteristic, error)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    owner?.didUpdateNotificationState(peripheral, characteristic, error)
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    owner?.didWrite(peripheral, characteristic, error)
  }

  // Peripheral manager (host role)
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    owner?.peripheralStateChanged(peripheral)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    owner?.serviceDidAdd(error: error)
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    owner?.advertisingDidStart(error: error)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    owner?.didReceiveRead(peripheral, request)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    owner?.didReceiveWrite(peripheral, requests)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    owner?.didSubscribe(peripheral, central, characteristic)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    owner?.didUnsubscribe(central, characteristic)
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    owner?.pumpNotify()
  }
}
