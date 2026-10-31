// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext

/**
 * Self-update of the sideloaded Android TV app (`src/platform/updates/`).
 *
 * - `selfUpdate`: true only in a build that declares REQUEST_INSTALL_PACKAGES
 *   (the sideload profile; see app.config.ts). Play builds do not declare it,
 *   so the updater stays off there, also after an over-the-air update.
 * - `download`: the APK into the app cache (`cache/updates/`), with progress
 *   events, and the SHA-256 checked against the feed. A file that is there
 *   already with the right checksum is not downloaded again.
 * - `install`: the system package installer (ACTION_VIEW on a FileProvider
 *   content URI). This works on Google TV, Android TV and Fire OS; a
 *   PackageInstaller session does not show its confirmation on some Fire OS
 *   versions. On success the system stops this app and puts the new one in
 *   its place.
 * - `openInstallSettings`: the "install unknown apps" switch of this app,
 *   or the nearest settings page that the device has.
 */
class ZoggyfinUpdaterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZoggyfinUpdater")
    Events("onProgress")

    /** `selfUpdate`, the installed `versionCode` and `versionName`. */
    Function("info") {
      val info = packageInfo()
      mapOf(
        "selfUpdate" to (info?.requestedPermissions?.contains(INSTALL_PERMISSION) == true),
        "versionCode" to info?.let { versionCodeOf(it).toDouble() },
        "versionName" to info?.versionName,
      )
    }

    /** True when the system lets this app start the package installer. */
    Function("canInstall") {
      val context = context() ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function true
      context.packageManager.canRequestPackageInstalls()
    }

    /** Returns the file path. Rejects with ERR_DOWNLOAD or ERR_CHECKSUM. */
    AsyncFunction("download") Coroutine { url: String, sha256: String, size: Long, name: String ->
      withContext(Dispatchers.IO) { download(url, sha256.lowercase(), size, name) }
    }

    /** "app": the switch of this app; "list": the list of apps; "settings": the settings; "none". */
    Function("openInstallSettings") {
      openInstallSettings()
    }

    Function("install") { path: String ->
      install(File(path.removePrefix("file://")))
    }
  }

  private fun context(): Context? = appContext.reactContext?.applicationContext

  private fun packageInfo(): PackageInfo? {
    val context = context() ?: return null
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
      }
    } catch (e: PackageManager.NameNotFoundException) {
      null
    }
  }

  private fun versionCodeOf(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

  private fun updatesDir(context: Context): File = File(context.cacheDir, "updates").apply { mkdirs() }

  private suspend fun download(url: String, sha256: String, size: Long, name: String): String {
    val context = context() ?: throw UpdateException("ERR_DOWNLOAD", "The app is not ready.")
    if (!name.matches(Regex("^[0-9A-Za-z._-]+\\.apk$"))) throw UpdateException("ERR_DOWNLOAD", "Bad file name.")
    val dir = updatesDir(context)
    val target = File(dir, name)
    // Older updates are of no use: keep only this file.
    dir.listFiles()?.forEach { if (it.name != name && it.name != "$name.part") it.delete() }
    if (target.isFile && target.length() == size && hashOf(target) == sha256) {
      emit(size, size)
      return target.absolutePath
    }
    target.delete()
    val part = File(dir, "$name.part")
    part.delete()

    val digest = MessageDigest.getInstance("SHA-256")
    var done = 0L
    var connection: HttpURLConnection? = null
    try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
        instanceFollowRedirects = true
        setRequestProperty("Accept-Encoding", "identity")
      }
      val code = connection.responseCode
      if (code !in 200..299) throw UpdateException("ERR_DOWNLOAD", "The server answered $code.")
      val total = connection.contentLengthLong.takeIf { it > 0 } ?: size
      var lastEmit = 0L
      connection.inputStream.use { input ->
        FileOutputStream(part).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            coroutineContext.ensureActive()
            val n = input.read(buffer)
            if (n < 0) break
            output.write(buffer, 0, n)
            digest.update(buffer, 0, n)
            done += n
            if (done > size) throw UpdateException("ERR_DOWNLOAD", "The file is larger than the feed says.")
            val now = SystemClock.elapsedRealtime()
            if (now - lastEmit >= PROGRESS_MS) {
              lastEmit = now
              emit(done, total)
            }
          }
        }
      }
      emit(done, total)
    } catch (e: IOException) {
      part.delete()
      throw UpdateException("ERR_DOWNLOAD", e.message ?: "The download failed.")
    } catch (e: Throwable) {
      part.delete()
      throw e
    } finally {
      connection?.disconnect()
    }
    val hash = digest.digest().joinToString("") { "%02x".format(it) }
    if (done != size || hash != sha256) {
      part.delete()
      throw UpdateException("ERR_CHECKSUM", "The file is damaged (the checksum does not match).")
    }
    if (!part.renameTo(target)) {
      part.delete()
      throw UpdateException("ERR_DOWNLOAD", "Cannot save the file.")
    }
    return target.absolutePath
  }

  private fun emit(done: Long, total: Long) {
    sendEvent("onProgress", mapOf("done" to done.toDouble(), "total" to total.toDouble()))
  }

  private fun hashOf(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun startActivity(intent: Intent): Boolean {
    val activity = appContext.currentActivity
    return try {
      // The installer or the settings page is not the user leaving: no Picture in Picture.
      ZoggyfinAndroidModule.holdPictureInPicture()
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        val context = context() ?: return false
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      false
    }
  }

  private fun openInstallSettings(): String {
    val context = context() ?: return "none"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Google TV and Android TV have the page of this app; some Fire OS versions only the list.
      if (startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))) return "app"
      if (startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))) return "list"
    }
    if (startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))) return "settings"
    if (startActivity(Intent(Settings.ACTION_SETTINGS))) return "settings"
    return "none"
  }

  private fun install(file: File) {
    val context = context() ?: throw UpdateException("ERR_INSTALL", "The app is not ready.")
    val dir = updatesDir(context).canonicalFile
    val apk = file.canonicalFile
    if (apk.parentFile != dir || !apk.isFile) throw UpdateException("ERR_INSTALL", "The downloaded file is missing.")
    val uri = FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY_SUFFIX", apk)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, APK_MIME)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    if (!startActivity(intent)) throw UpdateException("ERR_INSTALL", "This device has no package installer that Zoggyfin can open.")
  }

  private class UpdateException(code: String, message: String) : CodedException(code, message, null)

  companion object {
    private const val PROGRESS_MS = 250L
    private const val APK_MIME = "application/vnd.android.package-archive"
    private const val INSTALL_PERMISSION = "android.permission.REQUEST_INSTALL_PACKAGES"

    /** The FileProvider authority is `<applicationId>` plus this (app.config.ts adds the provider). */
    const val AUTHORITY_SUFFIX = ".zoggyfin.updates"
  }
}

/** Shares the downloaded APK with the package installer (`res/xml/zoggyfin_update_paths.xml`). */
class ZoggyfinUpdateFileProvider : FileProvider()
