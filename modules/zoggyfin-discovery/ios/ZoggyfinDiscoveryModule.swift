// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Darwin
import ExpoModulesCore
import Foundation
import Network

/// Turns on Jellyfin's UDP discovery (a broadcast to port 7359). iOS sends
/// broadcasts only with the Multicast Networking entitlement
/// (`com.apple.developer.networking.multicast`), which Apple gives on request.
/// Keep this false until the app has the entitlement; the app then finds
/// servers with the HTTP scan only. The steps are in the design spec
/// (docs/specs, "UDP discovery on iOS").
let udpDiscoveryEnabled = false

/// The Bonjour type of the local network check. It must be in
/// `NSBonjourServices` (app.json), or the browse fails.
let lanCheckServiceType = "_zgf-lan._tcp"

/// Finds Jellyfin servers on the local network and checks local network access.
public class ZoggyfinDiscoveryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZoggyfinDiscovery")

    /// True when `discover` sends the UDP broadcast (see `udpDiscoveryEnabled`).
    Constant("udpSupported") { udpDiscoveryEnabled }

    /// The IPv4 addresses of the device that are up, with their prefix lengths.
    Function("interfaces") { () -> [[String: Any]] in
      Interfaces.ipv4().map { ["name": $0.name, "address": $0.address, "prefix": $0.prefix] }
    }

    /// Asks the system for local network access (the first call shows the prompt)
    /// and tells the result: "granted", "denied" or "unknown" (no answer before the timeout).
    AsyncFunction("localNetworkAccess") { (timeoutMs: Int, promise: Promise) in
      LocalNetworkCheck().run(timeout: Double(max(500, min(timeoutMs, 120_000))) / 1000) { promise.resolve($0) }
    }

    /// Sends "who is JellyfinServer?" and collects the answers for `timeoutMs`.
    /// Gives no answers while `udpDiscoveryEnabled` is false.
    AsyncFunction("discover") { (timeoutMs: Int, promise: Promise) in
      guard udpDiscoveryEnabled else {
        promise.resolve([String]())
        return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(UdpDiscovery.run(timeout: Double(max(200, min(timeoutMs, 10_000))) / 1000))
      }
    }
  }
}

enum Interfaces {
  struct Entry {
    let name: String
    let address: String
    let prefix: Int
    let broadcast: String?
  }

  static func ipv4() -> [Entry] {
    var out: [Entry] = []
    var head: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&head) == 0, let first = head else { return out }
    defer { freeifaddrs(head) }
    for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let ifa = ptr.pointee
      let flags = Int32(ifa.ifa_flags)
      guard (flags & IFF_UP) != 0, (flags & IFF_LOOPBACK) == 0,
        let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET),
        let mask = ifa.ifa_netmask
      else { continue }
      let a = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr.s_addr }
      let m = mask.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr.s_addr }
      let prefix = UInt32(bigEndian: m).nonzeroBitCount
      let bcast: String? = (flags & IFF_BROADCAST) != 0 ? text(a | ~m) : nil
      out.append(Entry(name: String(cString: ifa.ifa_name), address: text(a), prefix: prefix, broadcast: bcast))
    }
    return out
  }

  /// An address in network byte order as text.
  static func text(_ s: in_addr_t) -> String {
    var addr = in_addr(s_addr: s)
    var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    inet_ntop(AF_INET, &addr, &buf, socklen_t(INET_ADDRSTRLEN))
    return String(cString: buf)
  }
}

/// The UDP broadcast of Jellyfin's discovery protocol (BSD sockets).
enum UdpDiscovery {
  static let question = "who is JellyfinServer?"
  static let port: UInt16 = 7359

  static func run(timeout: TimeInterval) -> [String] {
    let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
    guard fd >= 0 else { return [] }
    defer { close(fd) }
    var on: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &on, socklen_t(MemoryLayout<Int32>.size))
    var targets = ["255.255.255.255"]
    for e in Interfaces.ipv4() { if let b = e.broadcast, !targets.contains(b) { targets.append(b) } }
    let bytes = Array(question.utf8)
    for t in targets {
      var to = sockaddr_in()
      to.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
      to.sin_family = sa_family_t(AF_INET)
      to.sin_port = port.bigEndian
      inet_pton(AF_INET, t, &to.sin_addr)
      _ = withUnsafePointer(to: &to) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          sendto(fd, bytes, bytes.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
    }
    var answers: [String] = []
    let deadline = Date().addingTimeInterval(timeout)
    var buf = [UInt8](repeating: 0, count: 4096)
    while answers.count < 64 {
      let left = deadline.timeIntervalSinceNow
      if left <= 0 { break }
      var tv = timeval(tv_sec: Int(left), tv_usec: Int32((left - floor(left)) * 1_000_000))
      setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
      let n = recv(fd, &buf, buf.count, 0)
      if n <= 0 { break }
      if let s = String(bytes: buf[0..<n], encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
        !s.isEmpty, s != question, !answers.contains(s)
      {
        answers.append(s)
      }
    }
    return answers
  }
}

/// Local network access has no API. The check advertises a Bonjour service
/// for a moment and browses for it (Apple's suggested way):
/// - the browser sees the service: access is granted;
/// - the browser waits with "policy denied": access is denied;
/// - no answer before the timeout (for example the prompt is still open): unknown.
/// The first check shows the system prompt.
final class LocalNetworkCheck {
  private let queue = DispatchQueue(label: "com.zogtech.zoggyfin.lan-check")
  private let name = "zoggyfin-" + UUID().uuidString
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var completion: ((String) -> Void)?
  /// The check keeps itself alive until it finishes.
  private var keep: LocalNetworkCheck?

  /// kDNSServiceErr_PolicyDenied: the user turned local network access off.
  private static let policyDenied: Int32 = -65570

  func run(timeout: TimeInterval, completion: @escaping (String) -> Void) {
    queue.async {
      self.keep = self
      self.completion = completion
      self.start()
      self.queue.asyncAfter(deadline: .now() + timeout) { self.finish("unknown") }
    }
  }

  private func start() {
    do {
      let params = NWParameters.tcp
      params.includePeerToPeer = false
      let l = try NWListener(using: params)
      l.service = NWListener.Service(name: name, type: lanCheckServiceType)
      l.newConnectionHandler = { $0.cancel() }
      l.stateUpdateHandler = { [weak self] state in
        if case .failed = state { self?.finish("unknown") }
      }
      l.start(queue: queue)
      listener = l
    } catch {
      finish("unknown")
      return
    }
    let params = NWParameters()
    params.includePeerToPeer = false
    let b = NWBrowser(for: .bonjour(type: lanCheckServiceType, domain: nil), using: params)
    b.stateUpdateHandler = { [weak self] state in
      switch state {
      case .waiting(let error), .failed(let error):
        if case .dns(let code) = error, Int32(code) == LocalNetworkCheck.policyDenied {
          self?.finish("denied")
        } else if case .failed = state {
          self?.finish("unknown")
        }
      default:
        break
      }
    }
    b.browseResultsChangedHandler = { [weak self] results, _ in
      guard let self else { return }
      for r in results {
        if case .service(let n, _, _, _) = r.endpoint, n == self.name {
          self.finish("granted")
          return
        }
      }
    }
    b.start(queue: queue)
    browser = b
  }

  private func finish(_ result: String) {
    guard let done = completion else { return }
    completion = nil
    listener?.cancel()
    browser?.cancel()
    listener = nil
    browser = nil
    done(result)
    keep = nil
  }
}
