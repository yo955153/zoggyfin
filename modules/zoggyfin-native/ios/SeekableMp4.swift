// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import AVFoundation
import Foundation

/// A transcoded download from Jellyfin is a fragmented MP4 with no index
/// (`ftyp moov moof mdat moof mdat ...`, no `sidx`). AVPlayer plays it, but
/// a far seek reads much of the file, and ExoPlayer cannot seek in it at
/// all. A nearby host shares its download with the guests, so an Android
/// guest could not start in the middle or follow a group seek.
///
/// `SeekableMp4.run` rewrites such a file as a plain MP4 with
/// AVAssetExportSession passthrough (no new encoding), with the index at the
/// front (`shouldOptimizeForNetworkUse`), and puts it in place of the old
/// file. The same step as `makeSeekableMp4` on Android (MediaMuxer).
///
/// Foundation and AVFoundation only: the iOS module and the macOS desktop
/// app (the nearby bridge) use the same file.
public enum SeekableMp4 {
  /// "done" (rewritten), "skipped" (not a fragmented MP4) or "failed" (the file stays as it was).
  public static func run(path: String, completion: @escaping (String) -> Void) {
    let file = path.hasPrefix("file://") ? (URL(string: path)?.path ?? path) : path
    DispatchQueue.global(qos: .utility).async {
      guard isFragmented(path: file) else {
        completion("skipped")
        return
      }
      export(file, completion: completion)
    }
  }

  /// True when the file has a top-level `moof` box. Reads only the box headers.
  static func isFragmented(path: String) -> Bool {
    guard let h = FileHandle(forReadingAtPath: path) else { return false }
    defer { try? h.close() }
    guard let size = try? h.seekToEnd(), size >= 8 else { return false }
    var offset: UInt64 = 0
    var boxes = 0
    while offset + 8 <= size, boxes < 64 {
      guard (try? h.seek(toOffset: offset)) != nil,
            let raw = try? h.read(upToCount: 16), raw.count >= 8 else { return false }
      let b = [UInt8](raw)
      var length = UInt64(b[0]) << 24 | UInt64(b[1]) << 16 | UInt64(b[2]) << 8 | UInt64(b[3])
      let type = String(bytes: b[4..<8], encoding: .ascii) ?? ""
      if type == "moof" { return true }
      if length == 1 {
        // A 64-bit size follows the type.
        guard b.count >= 16 else { return false }
        length = b[8..<16].reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
      } else if length == 0 {
        length = size - offset
      }
      guard length >= 8 else { return false }
      offset += length
      boxes += 1
    }
    return false
  }

  private static func export(_ path: String, completion: @escaping (String) -> Void) {
    let url = URL(fileURLWithPath: path)
    let asset = AVURLAsset(url: url)
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
      completion("failed")
      return
    }
    // A hidden file in the same folder: the move into place stays on one volume.
    let tmp = url.deletingLastPathComponent().appendingPathComponent(".seekable-\(UUID().uuidString).mp4")
    session.outputURL = tmp
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    session.exportAsynchronously {
      guard session.status == .completed else {
        try? FileManager.default.removeItem(at: tmp)
        NSLog("[downloads] seekable MP4 failed: %@", session.error?.localizedDescription ?? "unknown")
        completion("failed")
        return
      }
      do {
        _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
        completion("done")
      } catch {
        try? FileManager.default.removeItem(at: tmp)
        completion("failed")
      }
    }
  }
}
