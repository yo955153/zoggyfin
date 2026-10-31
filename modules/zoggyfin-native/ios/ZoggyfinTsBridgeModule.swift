// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import ExpoModulesCore
import UIKit

struct TsBridgeStartOptions: Record {
  /// Keep the other sessions. Default: they stop (zapping).
  @Field var keepOthers: Bool = false
  @Field var targetDuration: Double = 2
  @Field var windowSize: Int = 6
  @Field var startTimeout: Double = 20
}

/// The TS bridge for iOS (TsBridge.swift): plays a progressive MPEG-TS stream
/// (an IPTV `.ts` URL that AVPlayer cannot open) as a live HLS playlist on
/// 127.0.0.1. The contract is `src/native/ts-bridge-types.ts`.
///
/// `start` resolves when the playlist has segments, with
/// `{ ok: true, id, playlistUrl }`, or `{ ok: false, code, message, httpStatus? }`.
/// `onStatus` reports `ready`, `reconnecting`, `ended` and `error` per session id.
/// The sessions keep running while the app runs in the background (playback,
/// Picture in Picture); when iOS suspends the app, the source drops and the
/// session reconnects or ends.
public class ZoggyfinTsBridgeModule: Module {
  private lazy var bridge = TsBridge { [weak self] body in
    self?.sendEvent("onStatus", body)
  }
  private var foreground: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ZoggyfinTsBridge")

    Events("onStatus")

    OnCreate {
      // Segments from an earlier run of the app.
      TsBridge.purgeStale()
      self.foreground = NotificationCenter.default.addObserver(
        forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil
      ) { [weak self] _ in
        self?.bridge.resume()
      }
    }

    OnDestroy {
      if let foreground = self.foreground { NotificationCenter.default.removeObserver(foreground) }
      self.bridge.stopAll()
    }

    AsyncFunction("start") { (url: String, headers: [String: String]?, options: TsBridgeStartOptions?, promise: Promise) in
      guard let source = URL(string: url), let scheme = source.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
        promise.resolve(["ok": false, "code": "badUrl", "message": "The stream address is not valid."])
        return
      }
      let o = options ?? TsBridgeStartOptions()
      var config = TsBridgeOptions()
      config.targetDuration = min(10, max(1, o.targetDuration))
      config.windowSize = min(20, max(3, o.windowSize))
      config.startTimeout = min(120, max(3, o.startTimeout))
      self.bridge.start(url: source, headers: headers ?? [:], options: config, keepOthers: o.keepOthers) { result in
        switch result {
        case .success(let r):
          promise.resolve(["ok": true, "id": r.id, "playlistUrl": r.playlistUrl])
        case .failure(let error):
          let e = error as? TsBridgeError
          var body: [String: Any] = ["ok": false, "code": e?.code ?? "server", "message": e?.message ?? error.localizedDescription]
          if let status = e?.httpStatus { body["httpStatus"] = status }
          promise.resolve(body)
        }
      }
    }

    AsyncFunction("stop") { (id: String, promise: Promise) in
      self.bridge.stop(id: id) { promise.resolve(nil) }
    }

    AsyncFunction("stopAll") { (promise: Promise) in
      self.bridge.stopAll { promise.resolve(nil) }
    }
  }
}
