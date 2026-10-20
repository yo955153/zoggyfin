// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Darwin
import Foundation
import Network

/// The Bonjour service type of a nearby session (must be in NSBonjourServices).
let nearbyServiceType = "_zgf-together._tcp"
/// The first 4 bytes of a control socket. Any other first bytes mean HTTP.
let controlPreface = Data("ZGF1".utf8)
/// The largest frame that a control socket accepts.
let maxFrame = 1_048_576
/// HTTP connections from one guest (one address) at most: a new one closes the oldest.
let maxHTTPPerGuest = 3
/// HTTP connections in all at most.
let maxHTTPTotal = 32

/// TCP with peer-to-peer Wi-Fi (AWDL) and no Nagle delay. `control`: a control socket of a
/// guest. It gets the interactive voice class (Wi-Fi WMM voice), so the clock pings and the
/// group state do not wait behind the media in the radio's queues.
func nearbyParameters(control: Bool = false) -> NWParameters {
  let tcp = NWProtocolTCP.Options()
  tcp.noDelay = true
  tcp.connectionTimeout = 10
  let params = NWParameters(tls: nil, tcp: tcp)
  params.includePeerToPeer = true
  if control { params.serviceClass = .interactiveVoice }
  return params
}

/// The send context of a control frame: IP metadata with the interactive voice class. The
/// host's control sockets come from the one listener that also takes the HTTP connections,
/// so their parameters cannot carry the class; each frame asks for it.
let controlFrameContext: NWConnection.ContentContext = {
  let ip = NWProtocolIP.Metadata()
  ip.serviceClass = .interactiveVoice
  return NWConnection.ContentContext(identifier: "zgf-control", metadata: [ip])
}()

/// The cross-platform nearby transport for Apple platforms (see
/// `src/together/link-native-types.ts` for the contract and the wire format).
///
/// Host: one listener on one port. It advertises `_zgf-together._tcp` with a
/// TXT record. A connection that starts with `ZGF1` is a control socket that
/// carries length-prefixed text frames; every other connection is HTTP and
/// gets the shared files. Guest: a browser, control sockets to a service or
/// to an address, and a loopback relay for the players.
///
/// Every state change runs on one serial queue.
public final class NearbyCore {
  private let queue = DispatchQueue(label: "zoggyfin.nearby")
  private weak var sink: NearbyEventSink?
  private var listener: NWListener?
  private var serviceName = ""
  private var txt: [String: String] = [:]
  private var browser: NWBrowser?
  /// Found services: instance name to TXT record.
  private var found: [String: [String: String]] = [:]
  private var sockets: [String: FrameSocket] = [:]
  private var http: [ObjectIdentifier: HTTPConnection] = [:]
  private var httpSerial = 0
  private let files = SharedFiles()
  private let relay = MediaRelay()

  public init(sink: NearbyEventSink) {
    self.sink = sink
  }

  private func emit(_ name: String, _ body: [String: Any]) {
    sink?.emit(name, body)
  }

  // MARK: Host

  /// Opens the session port and advertises it. Completes with the port and the instance name.
  public func startServer(name: String, txt: [String: String], completion: @escaping (Result<(port: Int, service: String), Error>) -> Void) {
    queue.async {
      self.stopServerNow()
      do {
        let l = try NWListener(using: nearbyParameters())
        self.serviceName = name
        self.txt = txt
        l.service = NWListener.Service(name: name, type: nearbyServiceType, domain: nil, txtRecord: NWTXTRecord(txt).data)
        var done = false
        l.stateUpdateHandler = { [weak self] state in
          switch state {
          case .ready:
            if !done, let port = l.port {
              done = true
              completion(.success((Int(port.rawValue), name)))
            }
          case .failed(let error):
            if !done {
              done = true
              completion(.failure(error))
            } else {
              self?.emit("onError", ["message": "The nearby session stopped: \(error.localizedDescription)", "code": "server"])
            }
            self?.queue.async { self?.stopServerNow() }
          case .waiting(let error):
            if Self.denied(error) {
              self?.emit("onError", ["message": "Local Network access is off for Zoggyfin.", "code": "local-network-denied"])
            }
          default:
            break
          }
        }
        l.serviceRegistrationUpdateHandler = { change in
          if case .add(let endpoint) = change, case .service(let actual, _, _, _) = endpoint {
            print("[nearby] advertised \(actual)")
          }
        }
        l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        l.start(queue: self.queue)
        self.listener = l
      } catch {
        completion(.failure(error))
      }
    }
  }

  public func stopAdvertising() {
    queue.async { self.listener?.service = nil }
  }

  public func share(urlPath: String, filePath: String, mimeType: String) {
    queue.async { self.files.share(urlPath: urlPath, filePath: filePath, mimeType: mimeType) }
  }

  /// Paces the responses of a shared file to its bitrate (bytes per second; 0 removes the pace).
  public func setPace(urlPath: String, bytesPerSecond: Double) {
    queue.async { self.files.setPace(urlPath: urlPath, bytesPerSecond: bytesPerSecond) }
  }

  public func unshareAll() {
    queue.async { self.files.removeAll() }
  }

  public func stopServer() {
    queue.async { self.stopServerNow() }
  }

  private func stopServerNow() {
    listener?.cancel()
    listener = nil
    files.removeAll()
    for c in http.values { c.cancel() }
    http.removeAll()
    // `closed` removes each socket and tells JavaScript.
    for s in sockets.values where s.inbound { s.cancel() }
  }

  /// Reads the first 4 bytes and decides: control socket or HTTP.
  private func accept(_ conn: NWConnection) {
    conn.start(queue: queue)
    conn.receive(minimumIncompleteLength: 4, maximumLength: 64 * 1024) { [weak self] data, _, _, error in
      guard let self, let data, data.count >= 4, error == nil else {
        conn.cancel()
        return
      }
      if data.prefix(4) == controlPreface {
        let id = UUID().uuidString
        let s = FrameSocket(id: id, connection: conn, inbound: true, owner: self, queue: self.queue)
        self.sockets[id] = s
        self.emit("onSocketOpen", ["socketId": id, "inbound": true])
        s.startReading(initial: data.dropFirst(4))
      } else {
        self.httpSerial += 1
        let h = HTTPConnection(connection: conn, initial: data, files: self.files, queue: self.queue, remote: Self.remoteHost(conn), serial: self.httpSerial) { [weak self] c in
          self?.http.removeValue(forKey: ObjectIdentifier(c))
        }
        self.limitHTTP(for: h.remote)
        self.http[ObjectIdentifier(h)] = h
        h.start()
      }
    }
  }

  /// Makes room for one more HTTP connection from `remote`: closes the oldest one of that
  /// guest past `maxHTTPPerGuest`, and the oldest of all past `maxHTTPTotal`. A player that
  /// seeks opens a new connection and leaves the old one, so the oldest is the one to go.
  private func limitHTTP(for remote: String) {
    let live = http.values.filter { !$0.isClosed }
    let mine = live.filter { $0.remote == remote }.sorted { $0.serial < $1.serial }
    for c in mine.prefix(max(0, mine.count - (maxHTTPPerGuest - 1))) { c.cancel() }
    let rest = live.filter { !$0.isClosed }.sorted { $0.serial < $1.serial }
    for c in rest.prefix(max(0, rest.count - (maxHTTPTotal - 1))) { c.cancel() }
  }

  /// The remote address of a connection, without the port ("10.0.0.5", "fe80::1%awdl0").
  static func remoteHost(_ conn: NWConnection) -> String {
    if case .hostPort(let host, _) = conn.endpoint { return "\(host)" }
    return "\(conn.endpoint)"
  }

  // MARK: Guest

  public func startBrowsing() {
    queue.async {
      self.browser?.cancel()
      self.found.removeAll()
      let b = NWBrowser(for: .bonjourWithTXTRecord(type: nearbyServiceType, domain: nil), using: nearbyParameters())
      b.stateUpdateHandler = { [weak self] state in
        switch state {
        case .failed(let error):
          self?.emit("onError", ["message": "Could not look for nearby sessions: \(error.localizedDescription)", "code": "browse"])
        case .waiting(let error):
          if Self.denied(error) {
            self?.emit("onError", ["message": "Local Network access is off for Zoggyfin.", "code": "local-network-denied"])
          }
        default:
          break
        }
      }
      b.browseResultsChangedHandler = { [weak self] results, _ in self?.update(results) }
      b.start(queue: self.queue)
      self.browser = b
    }
  }

  public func stopBrowsing() {
    queue.async {
      self.browser?.cancel()
      self.browser = nil
      self.found.removeAll()
    }
  }

  /// One service can show on several interfaces (Wi-Fi, AWDL): one entry per name.
  private func update(_ results: Set<NWBrowser.Result>) {
    var now: [String: [String: String]] = [:]
    for r in results {
      guard case .service(let name, _, _, _) = r.endpoint else { continue }
      var record: [String: String] = now[name] ?? [:]
      if case .bonjour(let t) = r.metadata {
        for (k, v) in t.dictionary { record[k] = v }
      }
      now[name] = record
    }
    for (name, record) in now where found[name] != record {
      emit("onServiceFound", ["serviceId": name, "name": name, "txt": record])
    }
    for name in found.keys where now[name] == nil {
      emit("onServiceLost", ["serviceId": name])
    }
    found = now
  }

  /// Opens a control socket to a found service. Returns the socket id at once.
  public func connect(serviceId: String) -> String {
    open(.service(name: serviceId, type: nearbyServiceType, domain: "local.", interface: nil))
  }

  /// Opens a control socket to an address (a join code).
  public func connect(host: String, port: Int) -> String {
    guard let p = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else { return open(nil) }
    return open(.hostPort(host: NWEndpoint.Host(host), port: p))
  }

  private func open(_ endpoint: NWEndpoint?) -> String {
    let id = UUID().uuidString
    queue.async {
      guard let endpoint else {
        self.emit("onSocketClosed", ["socketId": id, "reason": "Bad address."])
        return
      }
      let conn = NWConnection(to: endpoint, using: nearbyParameters(control: true))
      let s = FrameSocket(id: id, connection: conn, inbound: false, owner: self, queue: self.queue)
      self.sockets[id] = s
      s.startOutbound()
    }
    return id
  }

  /// A player URL base: a loopback relay to the host.
  public func mediaBase(serviceId: String?, host: String?, port: Int, completion: @escaping (Result<String, Error>) -> Void) {
    let target: NWEndpoint
    if let serviceId, !serviceId.isEmpty {
      target = .service(name: serviceId, type: nearbyServiceType, domain: "local.", interface: nil)
    } else if let host, let p = NWEndpoint.Port(rawValue: UInt16(clamping: port)) {
      target = .hostPort(host: NWEndpoint.Host(host), port: p)
    } else {
      completion(.failure(NSError(domain: "Nearby", code: 1, userInfo: [NSLocalizedDescriptionKey: "No host to stream from."])))
      return
    }
    relay.start(target: target) { result in
      completion(result.map { "http://127.0.0.1:\($0)" })
    }
  }

  public func stopRelay() {
    relay.stop()
  }

  // MARK: Both

  public func send(socketId: String, text: String) -> Bool {
    queue.sync {
      guard let s = sockets[socketId], s.isOpen else { return false }
      s.send(Data(text.utf8))
      return true
    }
  }

  /// Host: a pong to a ping. The text is built here and `t2` is stamped right before the frame
  /// goes to the connection, after any wait in JavaScript or in the Mac app's bridge.
  public func sendPong(socketId: String, id: Double, t0: Double, t1: Double) -> Bool {
    guard id.isFinite, t0.isFinite, t1.isFinite else { return false }
    queue.async {
      guard let s = self.sockets[socketId], s.isOpen else { return }
      let text = "{\"v\":1,\"t\":\"pong\",\"id\":\(Int64(id)),\"t0\":\(t0),\"t1\":\(t1),\"t2\":\(nearbyMonotonicMs())}"
      s.send(Data(text.utf8))
    }
    return true
  }

  public func close(socketId: String) {
    queue.async { self.sockets[socketId]?.cancel() }
  }

  public func stopAll() {
    queue.async {
      self.stopServerNow()
      self.browser?.cancel()
      self.browser = nil
      self.found.removeAll()
      for s in self.sockets.values { s.cancel() }
    }
    relay.stop()
  }

  public func stats() -> [String: Int] {
    queue.sync { ["served": files.bytesServed, "requests": files.requests, "relayed": relay.bytesRelayed] }
  }

  /// The IPv4 addresses of the interfaces that are up (not loopback).
  public static func addresses() -> [[String: String]] {
    var out: [[String: String]] = []
    var head: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&head) == 0, let first = head else { return out }
    defer { freeifaddrs(head) }
    var p: UnsafeMutablePointer<ifaddrs>? = first
    while let cur = p {
      defer { p = cur.pointee.ifa_next }
      let flags = Int32(cur.pointee.ifa_flags)
      guard let sa = cur.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET),
            flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      guard getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
      let name = String(cString: cur.pointee.ifa_name)
      let address = String(cString: host)
      if address.hasPrefix("169.254.") { continue }
      out.append(["name": name, "address": address, "kind": kind(of: name)])
    }
    return out
  }

  private static func kind(of name: String) -> String {
    // bridge100: the Mac's Internet Sharing or the iPhone's Personal Hotspot.
    if name.hasPrefix("bridge") { return "hotspot" }
    if name == "en0" { return "wifi" }
    if name.hasPrefix("en") { return "ethernet" }
    return "other"
  }

  /// True for the DNS-SD "policy denied" error: Local Network access is off.
  static func denied(_ error: NWError) -> Bool {
    if case .dns(let code) = error { return code == -65570 }
    return false
  }

  // MARK: Socket callbacks (on `queue`)

  fileprivate func opened(_ s: FrameSocket) {
    emit("onSocketOpen", ["socketId": s.id, "inbound": s.inbound])
  }

  fileprivate func frame(_ s: FrameSocket, _ text: String, at: Double) {
    emit("onFrame", ["socketId": s.id, "text": text, "receivedAt": at])
  }

  fileprivate func closed(_ s: FrameSocket, reason: String?) {
    guard sockets.removeValue(forKey: s.id) != nil else { return }
    var body: [String: Any] = ["socketId": s.id]
    body["reason"] = reason ?? NSNull()
    emit("onSocketClosed", body)
  }
}

/// A control socket: length-prefixed UTF-8 frames both ways.
private final class FrameSocket {
  let id: String
  let inbound: Bool
  private let connection: NWConnection
  private weak var owner: NearbyCore?
  /// The owner's serial queue: every callback of this socket runs there.
  private let queue: DispatchQueue
  private var buffer = Data()
  private(set) var isOpen: Bool
  private var done = false

  init(id: String, connection: NWConnection, inbound: Bool, owner: NearbyCore, queue: DispatchQueue) {
    self.id = id
    self.queue = queue
    self.connection = connection
    self.inbound = inbound
    self.owner = owner
    self.isOpen = inbound
    connection.stateUpdateHandler = { [weak self] state in self?.changed(state) }
  }

  /// Guest: connects, sends the preface, then reads.
  func startOutbound() {
    connection.start(queue: queue)
  }

  private func changed(_ state: NWConnection.State) {
    switch state {
    case .ready:
      guard !inbound, !isOpen else { return }
      isOpen = true
      connection.send(content: controlPreface, completion: .contentProcessed { _ in })
      owner?.opened(self)
      read()
    case .waiting(let error):
      // No route yet (for example the Wi-Fi is off). Give up: the session needs a link now.
      if !inbound && !isOpen { finish("Could not connect: \(error.localizedDescription)") }
    case .failed(let error):
      finish(error.localizedDescription)
    case .cancelled:
      finish(nil)
    default:
      break
    }
  }

  func startReading(initial: Data) {
    buffer.append(initial)
    parse()
    read()
  }

  private func read() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, error in
      guard let self else { return }
      let at = nearbyMonotonicMs()
      if let data, !data.isEmpty {
        self.buffer.append(data)
        if !self.parse(at: at) { return }
      }
      if let error {
        self.finish(error.localizedDescription)
        return
      }
      if complete {
        self.connection.cancel()
        return
      }
      self.read()
    }
  }

  /// Takes the whole frames out of the buffer. False when the socket closed (bad length).
  @discardableResult
  private func parse(at: Double = nearbyMonotonicMs()) -> Bool {
    while buffer.count >= 4 {
      let b = [UInt8](buffer.prefix(4))
      let n = Int(b[0]) << 24 | Int(b[1]) << 16 | Int(b[2]) << 8 | Int(b[3])
      guard n >= 1, n <= maxFrame else {
        connection.cancel()
        return false
      }
      guard buffer.count >= 4 + n else { break }
      let body = buffer.subdata(in: buffer.startIndex + 4..<buffer.startIndex + 4 + n)
      buffer.removeSubrange(buffer.startIndex..<buffer.startIndex + 4 + n)
      if let text = String(data: body, encoding: .utf8) { owner?.frame(self, text, at: at) }
    }
    return true
  }

  func send(_ body: Data) {
    var frame = Data(capacity: 4 + body.count)
    let n = UInt32(body.count).bigEndian
    withUnsafeBytes(of: n) { frame.append(contentsOf: $0) }
    frame.append(body)
    connection.send(content: frame, contentContext: controlFrameContext, isComplete: true, completion: .contentProcessed { [weak self] error in
      if error != nil { self?.connection.cancel() }
    })
  }

  func cancel() {
    connection.cancel()
  }

  private func finish(_ reason: String?) {
    guard !done else { return }
    done = true
    isOpen = false
    connection.cancel()
    owner?.closed(self, reason: reason)
  }
}
