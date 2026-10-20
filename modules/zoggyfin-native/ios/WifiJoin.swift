// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Foundation
#if os(iOS)
import NetworkExtension
#elseif os(macOS)
import CoreWLAN
#endif

private func wifiLog(_ text: String) {
  NSLog("[nearby-wifi] %@", text)
}

/// The error of `WifiJoin.join`. The message goes to JavaScript.
public struct WifiJoinError: LocalizedError {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// Joins the Wi-Fi network of a session (the rendezvous). iOS uses
/// NEHotspotConfiguration (joinOnce). macOS uses CoreWLAN.
/// The result goes to the completion and also as the `onWifi` event.
public final class WifiJoin {
  private weak var sink: NearbyEventSink?

  public init(sink: NearbyEventSink) {
    self.sink = sink
  }

  private func finish(_ ssid: String, _ error: Error?, _ completion: @escaping (Error?) -> Void) {
    if let error {
      wifiLog("join \"\(ssid)\" failed: \(error.localizedDescription)")
      sink?.emit("onWifi", ["state": "failed", "ssid": ssid, "message": error.localizedDescription])
    } else {
      wifiLog("joined \"\(ssid)\"")
      sink?.emit("onWifi", ["state": "joined", "ssid": ssid])
    }
    completion(error)
  }

  #if os(iOS)

  /// Joins the network. The system asks the user. Needs the entitlement
  /// `com.apple.developer.networking.HotspotConfiguration`.
  public func join(ssid: String, password: String, completion: @escaping (Error?) -> Void) {
    let config = password.isEmpty
      ? NEHotspotConfiguration(ssid: ssid)
      : NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: false)
    config.joinOnce = true
    wifiLog("join \"\(ssid)\"")
    NEHotspotConfigurationManager.shared.apply(config) { error in
      if let error = error as NSError? {
        let already = error.domain == NEHotspotConfigurationErrorDomain
          && error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue
        if !already {
          self.finish(ssid, WifiJoinError(error.localizedDescription), completion)
          return
        }
        wifiLog("\"\(ssid)\": already associated")
      }
      self.verify(ssid: ssid, attempt: 0, completion: completion)
    }
  }

  /// `apply` can succeed when the device did not join. `fetchCurrent` tells
  /// the current network, but only with the location permission or the
  /// hotspot entitlement. If it gives nil, accept the join after a short wait.
  private func verify(ssid: String, attempt: Int, completion: @escaping (Error?) -> Void) {
    NEHotspotNetwork.fetchCurrent { network in
      if let network {
        if network.ssid == ssid {
          self.finish(ssid, nil, completion)
        } else if attempt < 5 {
          wifiLog("verify \"\(ssid)\": current is \"\(network.ssid)\"; try again")
          DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.verify(ssid: ssid, attempt: attempt + 1, completion: completion)
          }
        } else {
          self.finish(ssid, WifiJoinError("The device is not on the network \(ssid)."), completion)
        }
      } else {
        wifiLog("verify \"\(ssid)\": current network unknown; wait")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
          self.finish(ssid, nil, completion)
        }
      }
    }
  }

  /// Removes the configuration; the device leaves the network.
  public func leave(ssid: String) {
    wifiLog("leave \"\(ssid)\"")
    NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
  }

  #elseif os(macOS)

  /// Joins the network with CoreWLAN, off the main thread.
  ///
  /// macOS 14 and later show the SSIDs (in a scan and for the current
  /// network) only with the Location permission. The Tauri app must have
  /// `NSLocationUsageDescription` (and ask for the permission) for this.
  /// Without it, the scan by name can still find the network, but the SSID
  /// check after the join cannot run.
  public func join(ssid: String, password: String, completion: @escaping (Error?) -> Void) {
    wifiLog("join \"\(ssid)\"")
    DispatchQueue.global(qos: .userInitiated).async {
      guard let iface = CWWiFiClient.shared().interface() else {
        self.finish(ssid, WifiJoinError("This Mac has no Wi-Fi interface."), completion)
        return
      }
      if iface.ssid() == ssid {
        self.finish(ssid, nil, completion)
        return
      }
      do {
        if iface.powerOn() == false { try iface.setPower(true) }
        let found = try iface.scanForNetworks(withName: ssid)
        guard let network = found.first(where: { $0.ssid == ssid }) ?? found.first else {
          self.finish(ssid, WifiJoinError("The network \(ssid) is not found."), completion)
          return
        }
        try iface.associate(to: network, password: password.isEmpty ? nil : password)
        self.finish(ssid, nil, completion)
      } catch {
        self.finish(ssid, WifiJoinError(error.localizedDescription), completion)
      }
    }
  }

  /// Leaves the network only if the Mac is on it now.
  public func leave(ssid: String) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let iface = CWWiFiClient.shared().interface(), iface.ssid() == ssid else { return }
      wifiLog("leave \"\(ssid)\"")
      iface.disassociate()
    }
  }

  #endif
}
