// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import CoreMedia
import ExpoModulesCore
import VideoToolbox

/// Decoder capabilities for the device profile, the backup flag for
/// downloads, and a view that receives hardware keyboard presses (iPad and
/// Mac keyboards).
public class ZoggyfinNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZoggyfinNative")

    /// True when the device decodes the codec in hardware. The simulator
    /// reports false for AV1.
    Function("isHardwareDecodeSupported") { (codec: String) -> Bool in
      switch codec {
      case "av1":
        if #available(iOS 17.0, *) {
          return VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1)
        }
        return false
      case "hevc":
        return VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)
      case "h264":
        return VTIsHardwareDecodeSupported(kCMVideoCodecType_H264)
      case "vp9":
        return VTIsHardwareDecodeSupported(kCMVideoCodecType_VP9)
      default:
        return false
      }
    }

    /// Keeps a file or folder (downloads) out of iCloud and computer backups.
    /// Returns false when the path does not exist or the flag cannot be set.
    Function("excludeFromBackup") { (path: String) -> Bool in
      var url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: url.path) else { return false }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      do {
        try url.setResourceValues(values)
        return true
      } catch {
        return false
      }
    }

    View(KeyInputView.self) {
      Events("onHardwareKey")

      Prop("enabled") { (view: KeyInputView, enabled: Bool) in
        view.isEnabled = enabled
      }
    }
  }
}
