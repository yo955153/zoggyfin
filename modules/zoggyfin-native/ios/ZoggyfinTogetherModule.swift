// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import ExpoModulesCore
import Foundation
import MultipeerConnectivity

/// Nearby "Watch together": Multipeer Connectivity for the session messages
/// (Bluetooth and peer-to-peer Wi-Fi, no router needed), a small HTTP range
/// server that shares a downloaded file, and a loopback relay through which a
/// guest's player reads that file.
///
/// The host advertises and accepts join requests. A guest browses and sends a
/// join request (a Multipeer invitation). Messages are UTF-8 JSON text.
public class ZoggyfinTogetherModule: Module {
  static let serviceType = "zgf-together"

  private let queue = DispatchQueue(label: "zoggyfin.together")
  private var me: MCPeerID?
  private var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?
  private var delegate: TogetherDelegate?
  /// Peer ids for JavaScript, both ways.
  private var ids: [MCPeerID: String] = [:]
  private var peers: [String: MCPeerID] = [:]
  private var invitations: [String: (Bool, MCSession?) -> Void] = [:]
  private let server = MediaServer()
  private let relay = MediaRelay()

  static func monotonicMs() -> Double {
    ProcessInfo.processInfo.systemUptime * 1000
  }

  func idFor(_ peer: MCPeerID) -> String {
    if let id = ids[peer] { return id }
    let id = UUID().uuidString
    ids[peer] = id
    peers[id] = peer
    return id
  }

  public func definition() -> ModuleDefinition {
    Name("ZoggyfinTogether")

    Events("onPeerFound", "onPeerLost", "onInvitation", "onPeerState", "onMessage", "onError")

    /// Milliseconds on a monotonic clock (time since boot). Message receive
    /// times use the same clock.
    Function("monotonicNow") { () -> Double in
      ZoggyfinTogetherModule.monotonicMs()
    }

    /// Starts a session as host: advertise, and wait for join requests.
    Function("startHosting") { (displayName: String, info: [String: String]) in
      self.queue.sync {
        self.teardown()
        let s = self.makeSession(displayName)
        let ad = MCNearbyServiceAdvertiser(peer: s.myPeerID, discoveryInfo: info, serviceType: Self.serviceType)
        ad.delegate = self.delegate
        ad.startAdvertisingPeer()
        self.advertiser = ad
      }
    }

    /// Looks for hosts nearby.
    Function("startBrowsing") { (displayName: String) in
      self.queue.sync {
        self.teardown()
        let s = self.makeSession(displayName)
        let b = MCNearbyServiceBrowser(peer: s.myPeerID, serviceType: Self.serviceType)
        b.delegate = self.delegate
        b.startBrowsingForPeers()
        self.browser = b
      }
    }

    /// Host: stop taking new join requests (the session stays).
    Function("stopAdvertising") {
      self.queue.sync { self.advertiser?.stopAdvertisingPeer() }
    }

    /// Guest: stop looking (the session stays).
    Function("stopBrowsing") {
      self.queue.sync { self.browser?.stopBrowsingForPeers() }
    }

    /// Guest: asks a host to join. `context` goes with the request.
    Function("invite") { (peerId: String, context: String) -> Bool in
      self.queue.sync {
        guard let peer = self.peers[peerId], let b = self.browser, let s = self.session else { return false }
        b.invitePeer(peer, to: s, withContext: context.data(using: .utf8), timeout: 60)
        return true
      }
    }

    /// Host: accepts or declines a join request.
    Function("respond") { (inviteId: String, accept: Bool) in
      self.queue.sync {
        guard let handler = self.invitations.removeValue(forKey: inviteId) else { return }
        handler(accept, accept ? self.session : nil)
      }
    }

    /// Sends text to some peers (or all connected peers when `peerIds` is null).
    Function("send") { (text: String, peerIds: [String]?, reliable: Bool) -> Bool in
      self.queue.sync {
        guard let s = self.session, let data = text.data(using: .utf8) else { return false }
        let targets = peerIds.map { $0.compactMap { self.peers[$0] } } ?? s.connectedPeers
        let connected = targets.filter { s.connectedPeers.contains($0) }
        guard !connected.isEmpty else { return false }
        do {
          try s.send(data, toPeers: connected, with: reliable ? .reliable : .unreliable)
          return true
        } catch {
          return false
        }
      }
    }

    /// Leaves the session and stops advertising and browsing.
    Function("stop") {
      self.queue.sync { self.teardown() }
    }

    /// Starts the media server. Resolves with the port and the Bonjour service name.
    AsyncFunction("startMediaServer") { (promise: Promise) in
      self.server.start { result in
        switch result {
        case .success(let (port, name)):
          promise.resolve(["port": Int(port), "service": name])
        case .failure(let error):
          promise.reject("ERR_MEDIA_SERVER", error.localizedDescription)
        }
      }
    }

    /// Shares a file at a URL path ("/<token>/media.mp4"). The path is the secret.
    Function("shareFile") { (urlPath: String, filePath: String, mimeType: String) in
      self.server.share(urlPath: urlPath, filePath: filePath, mimeType: mimeType)
    }

    Function("stopMediaServer") {
      self.server.stop()
    }

    /// Guest: a loopback port that relays to the host's media service.
    AsyncFunction("startRelay") { (service: String, promise: Promise) in
      self.relay.start(service: service) { result in
        switch result {
        case .success(let port):
          promise.resolve(Int(port))
        case .failure(let error):
          promise.reject("ERR_RELAY", error.localizedDescription)
        }
      }
    }

    Function("stopRelay") {
      self.relay.stop()
    }

    /// Byte counters, for measurements.
    Function("mediaStats") { () -> [String: Any] in
      ["served": self.server.bytesServed, "requests": self.server.requests, "relayed": self.relay.bytesRelayed]
    }

    OnDestroy {
      self.queue.sync { self.teardown() }
      self.server.stop()
      self.relay.stop()
    }
  }

  /// One MCPeerID per display name, kept for the app's life (Apple's advice).
  private static var peerIds: [String: MCPeerID] = [:]

  private func makeSession(_ displayName: String) -> MCSession {
    let name = String(displayName.prefix(40)).isEmpty ? "Zoggyfin" : String(displayName.prefix(40))
    let peer = Self.peerIds[name] ?? MCPeerID(displayName: name)
    Self.peerIds[name] = peer
    me = peer
    let d = TogetherDelegate(module: self)
    delegate = d
    let s = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    s.delegate = d
    session = s
    return s
  }

  /// Call on `queue`.
  private func teardown() {
    advertiser?.stopAdvertisingPeer()
    advertiser?.delegate = nil
    advertiser = nil
    browser?.stopBrowsingForPeers()
    browser?.delegate = nil
    browser = nil
    for (_, handler) in invitations { handler(false, nil) }
    invitations.removeAll()
    session?.disconnect()
    session?.delegate = nil
    session = nil
    delegate = nil
  }

  // MARK: Delegate callbacks (from Multipeer queues)

  fileprivate func found(_ peer: MCPeerID, info: [String: String]?) {
    queue.async {
      let id = self.idFor(peer)
      self.sendEvent("onPeerFound", ["peerId": id, "name": peer.displayName, "info": info ?? [:]])
    }
  }

  fileprivate func lost(_ peer: MCPeerID) {
    queue.async {
      self.sendEvent("onPeerLost", ["peerId": self.idFor(peer)])
    }
  }

  fileprivate func invited(by peer: MCPeerID, context: Data?, handler: @escaping (Bool, MCSession?) -> Void) {
    queue.async {
      let inviteId = UUID().uuidString
      self.invitations[inviteId] = handler
      let text = context.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      self.sendEvent("onInvitation", ["inviteId": inviteId, "peerId": self.idFor(peer), "name": peer.displayName, "context": text])
    }
  }

  fileprivate func changed(_ peer: MCPeerID, state: MCSessionState, in s: MCSession) {
    queue.async {
      guard s === self.session else { return }
      let name: String
      switch state {
      case .connected: name = "connected"
      case .connecting: name = "connecting"
      case .notConnected: name = "notConnected"
      @unknown default: name = "notConnected"
      }
      self.sendEvent("onPeerState", ["peerId": self.idFor(peer), "name": peer.displayName, "state": name])
    }
  }

  fileprivate func received(_ data: Data, from peer: MCPeerID, at: Double, in s: MCSession) {
    queue.async {
      guard s === self.session, let text = String(data: data, encoding: .utf8) else { return }
      self.sendEvent("onMessage", ["peerId": self.idFor(peer), "text": text, "receivedAt": at])
    }
  }

  fileprivate func failed(_ message: String) {
    queue.async {
      self.sendEvent("onError", ["message": message])
    }
  }
}

/// One object for the session, advertiser and browser delegates.
private final class TogetherDelegate: NSObject, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
  weak var module: ZoggyfinTogetherModule?

  init(module: ZoggyfinTogetherModule) {
    self.module = module
  }

  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    module?.changed(peerID, state: state, in: session)
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    let at = ZoggyfinTogetherModule.monotonicMs()
    module?.received(data, from: peerID, at: at, in: session)
  }

  func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {
    stream.close()
  }

  func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}

  func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}

  func session(_ session: MCSession, didReceiveCertificate certificate: [Any]?, fromPeer peerID: MCPeerID, certificateHandler: @escaping (Bool) -> Void) {
    certificateHandler(true)
  }

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
    module?.invited(by: peerID, context: context, handler: invitationHandler)
  }

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
    module?.failed("Could not start the nearby session: \(error.localizedDescription)")
  }

  func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
    module?.found(peerID, info: info)
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    module?.lost(peerID)
  }

  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
    module?.failed("Could not look for nearby sessions: \(error.localizedDescription)")
  }
}
