// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The C API of the nearby transport for the macOS desktop app (Tauri).
// The Swift parts are the same files as in the iOS module
// (`modules/zoggyfin-native/ios/`). `build.rs` compiles them and this file
// into a static library; `src/nearby.rs` calls the two C functions.
//
// - `zgf_nearby_init(callback)`: sets the callback. The callback gets UTF-8 JSON.
// - `zgf_nearby_call(json)`: runs one command, `{"id": n, "cmd": "...", "args": [...]}`.
//   The answer goes to the callback: `{"reply": n, "ok": true, "value": ...}` or
//   `{"reply": n, "ok": false, "error": "..."}`. Sync commands answer at once,
//   async commands answer later.
// - `zgf_nearby_post(json)`: runs a batch of short commands, `[{"cmd": "...", "args": [...]}, ...]`,
//   in order and with no answers (send, sendMany, close, ...).
// - Events go to the callback as `{"event": name, "body": {...}}`.
//
// `connect` and `connectAddress` take an optional last argument: the socket id
// that JavaScript chose. The bridge keeps a map from that id to the id of
// `NearbyCore`, and it changes the ids in the events and the commands.

import AppKit
import CoreLocation
import Foundation

public typealias ZgfNearbyCallback = @convention(c) (UnsafePointer<CChar>) -> Void

/// The command failed; the message goes to JavaScript.
private struct BridgeError: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// The answer to one command.
private enum Answer {
  case value(Any)
  case later
}

private final class NearbyBridge: NearbyEventSink {
  static let shared = NearbyBridge()

  private let lock = NSLock()
  private var callback: ZgfNearbyCallback?
  /// JavaScript socket id to `NearbyCore` socket id, and the reverse.
  private var toNative: [String: String] = [:]
  private var toJs: [String: String] = [:]

  // Made in `init` (not lazy): the commands come from more than one thread.
  // `NearbyBle` makes no Bluetooth manager before the first BLE command.
  private var core: NearbyCore!
  private var ble: NearbyBle!
  private var wifi: WifiJoin!
  private let location = LocationGate()

  private init() {
    core = NearbyCore(sink: self)
    ble = NearbyBle(sink: self)
    wifi = WifiJoin(sink: self)
  }

  func setCallback(_ cb: ZgfNearbyCallback?) {
    lock.lock()
    callback = cb
    lock.unlock()
  }

  // MARK: Output

  private func post(_ object: [String: Any]) {
    lock.lock()
    let cb = callback
    lock.unlock()
    guard let cb else { return }
    let data: Data
    if JSONSerialization.isValidJSONObject(object), let d = try? JSONSerialization.data(withJSONObject: object) {
      data = d
    } else {
      // An answer that is not JSON: send an error in its place.
      let id = object["reply"] ?? NSNull()
      data = (try? JSONSerialization.data(withJSONObject: ["reply": id, "ok": false, "error": "The answer is not JSON."])) ?? Data()
    }
    guard let text = String(data: data, encoding: .utf8) else { return }
    text.withCString { cb($0) }
  }

  private func reply(_ id: Any, _ value: Any?) {
    post(["reply": id, "ok": true, "value": value ?? NSNull()])
  }

  private func fail(_ id: Any, _ message: String) {
    post(["reply": id, "ok": false, "error": message])
  }

  func emit(_ name: String, _ body: [String: Any]) {
    var body = body
    if let native = body["socketId"] as? String {
      lock.lock()
      if let js = toJs[native] {
        body["socketId"] = js
        if name == "onSocketClosed" {
          toJs.removeValue(forKey: native)
          toNative.removeValue(forKey: js)
        }
      }
      lock.unlock()
    }
    post(["event": name, "body": body])
  }

  private func nativeId(_ js: String) -> String {
    lock.lock()
    defer { lock.unlock() }
    return toNative[js] ?? js
  }

  /// Opens a socket with `open` and keeps the id of JavaScript for it.
  /// The lock stays held while `open` runs, so the first event of the socket
  /// finds the map entry. `NearbyCore.connect` does not wait for its queue.
  private func connectMapped(_ jsId: String?, _ open: () -> String) -> String {
    lock.lock()
    defer { lock.unlock() }
    let native = open()
    guard let jsId, !jsId.isEmpty else { return native }
    toNative[jsId] = native
    toJs[native] = jsId
    return jsId
  }

  // MARK: Input

  /// A batch of short commands with no answers (`[{"cmd": ..., "args": [...]}, ...]`), in order.
  /// A failed command goes to the log; the next ones still run.
  func post(_ json: String) {
    guard let data = json.data(using: .utf8),
          let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
      NSLog("[nearby] bad batch")
      return
    }
    for msg in list {
      let cmd = msg["cmd"] as? String ?? ""
      do {
        _ = try run(cmd, Args(msg["args"] as? [Any] ?? []), NSNull())
      } catch let e as BridgeError {
        NSLog("[nearby] %@ failed: %@", cmd, e.message)
      } catch {
        NSLog("[nearby] %@ failed: %@", cmd, error.localizedDescription)
      }
    }
  }

  func call(_ json: String) {
    guard let data = json.data(using: .utf8),
          let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      NSLog("[nearby] bad call: %@", json)
      return
    }
    let id = msg["id"] ?? NSNull()
    let cmd = msg["cmd"] as? String ?? ""
    let args = msg["args"] as? [Any] ?? []
    do {
      switch try run(cmd, Args(args), id) {
      case .value(let v): reply(id, v)
      case .later: break
      }
    } catch let e as BridgeError {
      fail(id, e.message)
    } catch {
      fail(id, error.localizedDescription)
    }
  }

  private func run(_ cmd: String, _ a: Args, _ id: Any) throws -> Answer {
    switch cmd {
    case "monotonicNow":
      return .value(nearbyMonotonicMs())

    // Host
    case "startServer":
      let name = try a.string(0)
      let txt = try a.stringMap(1)
      core.startServer(name: name, txt: txt) { result in
        switch result {
        case .success(let r): self.reply(id, ["port": r.port, "service": r.service])
        case .failure(let error): self.fail(id, error.localizedDescription)
        }
      }
      return .later
    case "stopAdvertising":
      core.stopAdvertising()
    case "shareFile":
      core.share(urlPath: try a.string(0), filePath: try a.string(1), mimeType: try a.string(2))
    case "setPace":
      core.setPace(urlPath: try a.string(0), bytesPerSecond: try a.double(1))
    case "unshareAll":
      core.unshareAll()
    case "stopServer":
      core.stopServer()

    // Guest
    case "startBrowsing":
      core.startBrowsing()
    case "stopBrowsing":
      core.stopBrowsing()
    case "connect":
      let serviceId = try a.string(0)
      return .value(connectMapped(a.optString(1)) { core.connect(serviceId: serviceId) })
    case "connectAddress":
      let host = try a.string(0)
      let port = try a.int(1)
      return .value(connectMapped(a.optString(2)) { core.connect(host: host, port: port) })
    case "mediaBase":
      core.mediaBase(serviceId: a.optString(0), host: a.optString(1), port: try a.int(2)) { result in
        switch result {
        case .success(let base): self.reply(id, base)
        case .failure(let error): self.fail(id, error.localizedDescription)
        }
      }
      return .later
    case "stopRelay":
      core.stopRelay()

    // Both
    case "send":
      return .value(core.send(socketId: nativeId(try a.string(0)), text: try a.string(1)))
    case "sendMany":
      core.sendMany(socketIds: try a.stringList(0).map(nativeId), text: try a.string(1))
    case "sendPong":
      return .value(core.sendPong(socketId: nativeId(try a.string(0)), id: try a.double(1), t0: try a.double(2), t1: try a.double(3)))
    case "close":
      core.close(socketId: nativeId(try a.string(0)))
    case "addresses":
      return .value(NearbyCore.addresses())
    case "stopAll":
      // NearbyCore closes the sockets here with no `onSocketClosed`: forget their ids.
      lock.lock()
      toNative.removeAll()
      toJs.removeAll()
      lock.unlock()
      core.stopAll()
    case "mediaStats":
      return .value(core.stats())

    // Bluetooth LE rendezvous
    case "bleState":
      ble.state { self.reply(id, $0) }
      return .later
    case "bleRequestPermission":
      ble.requestPermission { self.reply(id, $0) }
      return .later
    case "bleAdvertise":
      ble.advertise(info: try a.string(0), localName: try a.string(1))
    case "bleStopAdvertising":
      ble.stopAdvertising()
    case "bleScan":
      ble.scan()
    case "bleStopScan":
      ble.stopScan()
    case "bleSend":
      return .value(ble.send(peerId: try a.string(0), text: try a.string(1)))
    case "bleDisconnect":
      ble.disconnect(peerId: try a.string(0))
    case "bleStopAll":
      ble.stopAll()

    // Wi-Fi join
    case "joinWifi":
      let ssid = try a.string(0)
      let password = try a.string(1)
      // macOS 14 and later give the SSIDs to CoreWLAN only with the Location permission.
      location.ask {
        self.wifi.join(ssid: ssid, password: password) { error in
          if let error { self.fail(id, error.localizedDescription) } else { self.reply(id, nil) }
        }
      }
      return .later
    case "leaveWifi":
      wifi.leave(ssid: try a.string(0))
    case "openSettings":
      DispatchQueue.main.async {
        let page = "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork"
        if let url = URL(string: page) { NSWorkspace.shared.open(url) }
      }

    default:
      throw BridgeError("Unknown nearby command: \(cmd)")
    }
    return .value(NSNull())
  }
}

/// The arguments of one command, with type checks.
private struct Args {
  let list: [Any]
  init(_ list: [Any]) { self.list = list }

  private func at(_ i: Int) -> Any? {
    guard i < list.count, !(list[i] is NSNull) else { return nil }
    return list[i]
  }

  func string(_ i: Int) throws -> String {
    guard let s = at(i) as? String else { throw BridgeError("Argument \(i + 1) must be a string.") }
    return s
  }

  func optString(_ i: Int) -> String? {
    at(i) as? String
  }

  func double(_ i: Int) throws -> Double {
    guard let n = at(i) as? NSNumber else { throw BridgeError("Argument \(i + 1) must be a number.") }
    return n.doubleValue
  }

  func int(_ i: Int) throws -> Int {
    guard let n = at(i) as? NSNumber else { throw BridgeError("Argument \(i + 1) must be a number.") }
    return n.intValue
  }

  func stringList(_ i: Int) throws -> [String] {
    guard let l = at(i) as? [Any] else { throw BridgeError("Argument \(i + 1) must be a list.") }
    return l.compactMap { $0 as? String }
  }

  func stringMap(_ i: Int) throws -> [String: String] {
    guard let m = at(i) as? [String: Any] else { throw BridgeError("Argument \(i + 1) must be an object.") }
    var out: [String: String] = [:]
    for (k, v) in m {
      if let s = v as? String { out[k] = s } else if let n = v as? NSNumber { out[k] = n.stringValue }
    }
    return out
  }
}

/// Asks for the Location permission one time, before a Wi-Fi join. The join
/// runs after the user answers (or at once if the answer is known). A denied
/// permission does not stop the join: the scan by name can still work.
private final class LocationGate: NSObject, CLLocationManagerDelegate {
  private var manager: CLLocationManager?
  private var waiters: [() -> Void] = []
  private var round = 0

  func ask(_ then: @escaping () -> Void) {
    DispatchQueue.main.async {
      let m = self.manager ?? CLLocationManager()
      if self.manager == nil {
        m.delegate = self
        self.manager = m
      }
      guard m.authorizationStatus == .notDetermined else {
        then()
        return
      }
      self.waiters.append(then)
      if self.waiters.count == 1 {
        self.round += 1
        let round = self.round
        m.requestWhenInUseAuthorization()
        // No answer in 60 s: join with no permission.
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
          if self.round == round { self.release() }
        }
      }
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus != .notDetermined { release() }
  }

  private func release() {
    round += 1
    let w = waiters
    waiters.removeAll()
    w.forEach { $0() }
  }
}

@_cdecl("zgf_nearby_init")
public func zgf_nearby_init(_ callback: ZgfNearbyCallback?) {
  NearbyBridge.shared.setCallback(callback)
}

@_cdecl("zgf_nearby_call")
public func zgf_nearby_call(_ json: UnsafePointer<CChar>) {
  NearbyBridge.shared.call(String(cString: json))
}

/// A batch of short commands with no answers (see `NearbyBridge.post`).
@_cdecl("zgf_nearby_post")
public func zgf_nearby_post(_ json: UnsafePointer<CChar>) {
  NearbyBridge.shared.post(String(cString: json))
}
