// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import ExpoModulesCore
import Foundation
import Security
import UIKit

/// Nearby "Watch together" and "Listen together" for iOS and iPadOS. The
/// transport is `NearbyCore` (Network.framework: Bonjour, peer-to-peer Wi-Fi,
/// framed control sockets and the HTTP range server on one port), the same
/// code as in the macOS desktop app. The contract is
/// `src/together/link-native-types.ts`.
public class ZoggyfinTogetherModule: Module {
  private lazy var sink = ModuleSink(module: self)
  private lazy var core = NearbyCore(sink: sink)
  private lazy var ble = NearbyBle(sink: sink)
  private lazy var wifi = WifiJoin(sink: sink)

  public func definition() -> ModuleDefinition {
    Name("ZoggyfinTogether")

    Events(
      "onServiceFound", "onServiceLost", "onSocketOpen", "onFrame", "onSocketClosed", "onError", "onHotspot",
      "onBleState", "onBlePeer", "onBlePeerLost", "onBleConnected", "onBleMessage", "onBleDisconnected", "onWifi"
    )

    Constant("platform") { "apple" }

    Function("monotonicNow") { () -> Double in
      nearbyMonotonicMs()
    }

    Function("randomBytes") { (n: Int) -> String in
      var bytes = [UInt8](repeating: 0, count: max(1, min(n, 1024)))
      guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return "" }
      return Data(bytes).base64EncodedString()
    }

    // MARK: Host

    AsyncFunction("startServer") { (serviceName: String, txt: [String: String], promise: Promise) in
      self.core.startServer(name: serviceName, txt: txt) { result in
        switch result {
        case .success(let r):
          promise.resolve(["port": r.port, "service": r.service])
        case .failure(let error):
          promise.reject("ERR_NEARBY_SERVER", error.localizedDescription)
        }
      }
    }

    Function("stopAdvertising") { self.core.stopAdvertising() }

    Function("shareFile") { (urlPath: String, filePath: String, mimeType: String) in
      self.core.share(urlPath: urlPath, filePath: filePath, mimeType: mimeType)
    }

    Function("unshareAll") { self.core.unshareAll() }

    Function("stopServer") { self.core.stopServer() }

    // MARK: Guest

    Function("startBrowsing") { self.core.startBrowsing() }

    Function("stopBrowsing") { self.core.stopBrowsing() }

    Function("connect") { (serviceId: String) -> String in
      self.core.connect(serviceId: serviceId)
    }

    Function("connectAddress") { (host: String, port: Int) -> String in
      self.core.connect(host: host, port: port)
    }

    AsyncFunction("mediaBase") { (serviceId: String?, host: String?, port: Int, promise: Promise) in
      self.core.mediaBase(serviceId: serviceId, host: host, port: port) { result in
        switch result {
        case .success(let base):
          promise.resolve(base)
        case .failure(let error):
          promise.reject("ERR_NEARBY_RELAY", error.localizedDescription)
        }
      }
    }

    Function("stopRelay") { self.core.stopRelay() }

    // MARK: Both

    Function("send") { (socketId: String, text: String) -> Bool in
      self.core.send(socketId: socketId, text: text)
    }

    Function("close") { (socketId: String) in
      self.core.close(socketId: socketId)
    }

    AsyncFunction("addresses") { () -> [[String: String]] in
      NearbyCore.addresses()
    }

    Function("stopAll") { self.core.stopAll() }

    Function("mediaStats") { () -> [String: Int] in
      self.core.stats()
    }

    // MARK: Bluetooth LE rendezvous

    AsyncFunction("bleState") { (promise: Promise) in
      self.ble.state { promise.resolve($0) }
    }

    AsyncFunction("bleRequestPermission") { (promise: Promise) in
      self.ble.requestPermission { promise.resolve($0) }
    }

    Function("bleAdvertise") { (info: String, localName: String) in
      self.ble.advertise(info: info, localName: localName)
    }

    Function("bleStopAdvertising") { self.ble.stopAdvertising() }

    Function("bleScan") { self.ble.scan() }

    Function("bleStopScan") { self.ble.stopScan() }

    Function("bleSend") { (peerId: String, text: String) -> Bool in
      self.ble.send(peerId: peerId, text: text)
    }

    Function("bleDisconnect") { (peerId: String) in
      self.ble.disconnect(peerId: peerId)
    }

    Function("bleStopAll") { self.ble.stopAll() }

    // MARK: Wi-Fi join

    AsyncFunction("joinWifi") { (ssid: String, password: String, promise: Promise) in
      self.wifi.join(ssid: ssid, password: password) { error in
        if let error {
          promise.reject("ERR_WIFI_JOIN", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }

    Function("leaveWifi") { (ssid: String) in
      self.wifi.leave(ssid: ssid)
    }

    Function("openSettings") {
      DispatchQueue.main.async {
        if let url = URL(string: UIApplication.openSettingsURLString) {
          UIApplication.shared.open(url)
        }
      }
    }

    OnDestroy {
      self.core.stopAll()
      self.ble.stopAll()
    }
  }
}

/// Sends the events of the nearby parts to JavaScript.
private final class ModuleSink: NearbyEventSink {
  weak var module: ZoggyfinTogetherModule?

  init(module: ZoggyfinTogetherModule) {
    self.module = module
  }

  func emit(_ name: String, _ body: [String: Any]) {
    module?.sendEvent(name, body)
  }
}
