// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Foundation

/// Receives the events of the nearby parts (`NearbyCore`, `NearbyBle`,
/// `WifiJoin`). The name and the body keys are the ones in
/// `src/together/link-native-types.ts`. The body holds only JSON values
/// (String, Double, Int, Bool, arrays and dictionaries of them).
///
/// This file and the other nearby files use Foundation, Network,
/// CoreBluetooth and NetworkExtension/CoreWLAN only, so that the iOS module
/// (ExpoModulesCore) and the macOS desktop app (a C bridge) use the same code.
public protocol NearbyEventSink: AnyObject {
  func emit(_ name: String, _ body: [String: Any])
}

/// Milliseconds on the monotonic clock (time since boot). Every `receivedAt` uses it.
public func nearbyMonotonicMs() -> Double {
  ProcessInfo.processInfo.systemUptime * 1000
}
