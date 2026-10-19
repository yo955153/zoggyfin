// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.os.Build
import android.util.Log
import android.view.Display
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android helpers for Zoggyfin:
 * - the decoders of the device (MediaCodecList) for the device profile;
 * - Picture in Picture on Home for Android 8 to 11. Android 12 and later
 *   enter it automatically through expo-video (`setAutoEnterEnabled`).
 */
class ZoggyfinAndroidModule : Module() {
  /** Set by JavaScript while a video plays in the full player. */
  @Volatile private var autoPictureInPicture = false
  private var report: Map<String, Any?>? = null

  override fun definition() = ModuleDefinition {
    Name("ZoggyfinAndroid")

    /** The decoders and the HDR types of the display. Read once and kept. */
    Function("decoders") {
      val r = report ?: decoderReport()
      report = r
      r
    }

    Function("setAutoPictureInPicture") { enabled: Boolean ->
      autoPictureInPicture = enabled
    }

    OnUserLeavesActivity {
      if (autoPictureInPicture && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        enterPictureInPicture()
      }
    }
  }

  private fun enterPictureInPicture() {
    val activity = appContext.currentActivity ?: return
    if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      // The aspect ratio and the source rectangle come from expo-video (setPictureInPictureParams).
      activity.enterPictureInPictureMode(PictureInPictureParams.Builder().build())
    } catch (e: IllegalStateException) {
      Log.w(TAG, "Picture in Picture is not available", e)
    } catch (e: IllegalArgumentException) {
      Log.w(TAG, "Picture in Picture is not available", e)
    }
  }

  private fun decoderReport(): Map<String, Any?> {
    val infos = try {
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
    } catch (e: RuntimeException) {
      emptyList()
    }
    val out = mutableMapOf<String, Any?>()
    for ((key, mime) in MIMES) {
      var hardware = false
      var software = false
      var maxLevel = 0
      var tenBit = false
      for (info in infos) {
        if (info.supportedTypes.none { it.equals(mime, ignoreCase = true) }) continue
        if (isHardware(info)) hardware = true else software = true
        val caps = try {
          info.getCapabilitiesForType(mime)
        } catch (e: RuntimeException) {
          null
        } ?: continue
        for (pl in caps.profileLevels) {
          maxLevel = maxOf(maxLevel, jellyfinLevel(key, pl.level))
          if (key == "hevc" && (pl.profile == CodecProfileLevel.HEVCProfileMain10 || pl.profile == CodecProfileLevel.HEVCProfileMain10HDR10)) {
            tenBit = true
          }
        }
      }
      out[key] = mapOf("hardware" to hardware, "software" to software, "maxLevel" to maxLevel, "tenBit" to tenBit)
    }
    out["hdr"] = hdrTypes()
    out["sdk"] = Build.VERSION.SDK_INT
    return out
  }

  private fun hdrTypes(): List<String> {
    val context = appContext.reactContext ?: return emptyList()
    return try {
      val display = (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.getDisplay(Display.DEFAULT_DISPLAY)
      @Suppress("DEPRECATION")
      val types: IntArray = display?.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
      val names = mutableListOf<String>()
      for (t in types) {
        when (t) {
          Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION -> names.add("dolbyVision")
          Display.HdrCapabilities.HDR_TYPE_HDR10 -> names.add("hdr10")
          Display.HdrCapabilities.HDR_TYPE_HLG -> names.add("hlg")
          4 -> names.add("hdr10Plus")
        }
      }
      names
    } catch (e: RuntimeException) {
      emptyList()
    }
  }

  private fun isHardware(info: MediaCodecInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return info.isHardwareAccelerated
    val name = info.name.lowercase()
    return !(name.startsWith("omx.google.") || name.startsWith("c2.android.") || name.startsWith("c2.google.") ||
      name.startsWith("omx.ffmpeg.") || name.contains(".sw.") || name.endsWith(".sw"))
  }

  /** The level in the numbers the Jellyfin server uses: H.264 5.1 is 51, HEVC 5.1 is 153. */
  private fun jellyfinLevel(key: String, level: Int): Int = when (key) {
    "h264" -> AVC_LEVELS.lastOrNull { (flag, _) -> level >= flag }?.second ?: 0
    "hevc" -> HEVC_LEVELS.lastOrNull { (flag, _) -> level >= flag }?.second ?: 0
    else -> 0
  }

  companion object {
    private const val TAG = "ZoggyfinAndroid"

    private val MIMES = listOf(
      "h264" to "video/avc",
      "hevc" to "video/hevc",
      "vp9" to "video/x-vnd.on2.vp9",
      "av1" to "video/av01",
      "dolbyVision" to "video/dolby-vision",
      "aac" to "audio/mp4a-latm",
      "mp3" to "audio/mpeg",
      "ac3" to "audio/ac3",
      "eac3" to "audio/eac3",
      "dts" to "audio/vnd.dts",
      "truehd" to "audio/true-hd",
      "flac" to "audio/flac",
      "opus" to "audio/opus",
      "vorbis" to "audio/vorbis",
      "alac" to "audio/alac",
    )

    /** Level flags in increasing order with the server numbers. */
    private val AVC_LEVELS = listOf(
      CodecProfileLevel.AVCLevel1 to 10,
      CodecProfileLevel.AVCLevel11 to 11,
      CodecProfileLevel.AVCLevel12 to 12,
      CodecProfileLevel.AVCLevel13 to 13,
      CodecProfileLevel.AVCLevel2 to 20,
      CodecProfileLevel.AVCLevel21 to 21,
      CodecProfileLevel.AVCLevel22 to 22,
      CodecProfileLevel.AVCLevel3 to 30,
      CodecProfileLevel.AVCLevel31 to 31,
      CodecProfileLevel.AVCLevel32 to 32,
      CodecProfileLevel.AVCLevel4 to 40,
      CodecProfileLevel.AVCLevel41 to 41,
      CodecProfileLevel.AVCLevel42 to 42,
      CodecProfileLevel.AVCLevel5 to 50,
      CodecProfileLevel.AVCLevel51 to 51,
      CodecProfileLevel.AVCLevel52 to 52,
      0x20000 to 60,
      0x40000 to 61,
      0x80000 to 62,
    )

    /** Main and high tier flags of one level are next to each other; both give the same number. */
    private val HEVC_LEVELS = listOf(
      CodecProfileLevel.HEVCMainTierLevel1 to 30,
      CodecProfileLevel.HEVCMainTierLevel2 to 60,
      CodecProfileLevel.HEVCMainTierLevel21 to 63,
      CodecProfileLevel.HEVCMainTierLevel3 to 90,
      CodecProfileLevel.HEVCMainTierLevel31 to 93,
      CodecProfileLevel.HEVCMainTierLevel4 to 120,
      CodecProfileLevel.HEVCMainTierLevel41 to 123,
      CodecProfileLevel.HEVCMainTierLevel5 to 150,
      CodecProfileLevel.HEVCMainTierLevel51 to 153,
      CodecProfileLevel.HEVCMainTierLevel52 to 156,
      CodecProfileLevel.HEVCMainTierLevel6 to 180,
      CodecProfileLevel.HEVCMainTierLevel61 to 183,
      CodecProfileLevel.HEVCMainTierLevel62 to 186,
    )
  }
}
