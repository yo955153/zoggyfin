// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Joins the Wi-Fi network of a host (for the Bluetooth rendezvous).
 *
 * - Android 10 and later: a WifiNetworkSpecifier request. The system asks
 *   the user. When the network is available, the process binds to it, so the
 *   sockets and the player's media URLs use it.
 * - Android 9: WifiManager.addNetwork and enableNetwork, then a wait (at most
 *   30 s) until the device is on the network.
 *
 * All state is on the main thread. The network callbacks post to it.
 */
@SuppressLint("MissingPermission")
internal class NearbyWifi(
  private val contextProvider: () -> Context?,
  private val emit: (String, Map<String, Any?>) -> Unit
) {
  companion object {
    private const val TAG = "ZoggyfinWifi"
    private const val LEGACY_TIMEOUT_MS = 30_000L
    private const val LEGACY_POLL_MS = 500L
  }

  private val main = Handler(Looper.getMainLooper())

  private var callback: ConnectivityManager.NetworkCallback? = null
  private var ssid: String? = null
  private var bound: Network? = null
  private var legacyId = -1
  private var legacyNetwork: Network? = null
  private var joined = false
  private var pending: OneShot? = null

  /** Settles a promise once. */
  private class OneShot(private val promise: Promise) {
    private val done = AtomicBoolean(false)

    fun resolve() {
      if (done.compareAndSet(false, true)) promise.resolve(null)
    }

    fun reject(code: String, message: String) {
      if (done.compareAndSet(false, true)) promise.reject(code, message, null)
    }
  }

  private fun context(): Context? = contextProvider()

  private fun connectivity(): ConnectivityManager? =
    context()?.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?

  private fun wifiManager(): WifiManager? = context()?.getSystemService(Context.WIFI_SERVICE) as WifiManager?

  fun join(ssid: String, password: String, promise: Promise) {
    main.post {
      leaveNow()
      val shot = OneShot(promise)
      if (context() == null) {
        shot.reject("ERR_WIFI", "The app is not ready.")
        return@post
      }
      this.ssid = ssid
      pending = shot
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        joinWithSpecifier(ssid, password, shot)
      } else {
        joinLegacy(ssid, password, shot)
      }
    }
  }

  fun leave(ssid: String) {
    main.post {
      // An empty name or the current name leaves the network.
      if (ssid.isEmpty() || this.ssid == null || this.ssid == ssid) leaveNow()
    }
  }

  fun dispose() {
    main.post { leaveNow() }
  }

  private fun bind(network: Network) {
    val cm = connectivity() ?: return
    try {
      cm.bindProcessToNetwork(network)
      bound = network
    } catch (e: Exception) {
      Log.w(TAG, "Could not bind to the network", e)
    }
  }

  private fun unbind() {
    if (bound == null) return
    try {
      connectivity()?.bindProcessToNetwork(null)
    } catch (e: Exception) {
    }
    bound = null
  }

  private fun failed(shot: OneShot, ssid: String, message: String) {
    shot.reject("ERR_WIFI", message)
    emit("onWifi", mapOf("state" to "failed", "ssid" to ssid, "message" to message))
  }

  /** Main thread. */
  @Suppress("DEPRECATION")
  private fun leaveNow() {
    pending?.reject("ERR_WIFI", "The Wi-Fi join was canceled.")
    pending = null
    val cb = callback
    callback = null
    if (cb != null) {
      try {
        connectivity()?.unregisterNetworkCallback(cb)
      } catch (e: IllegalArgumentException) {
        // The callback is not registered.
      }
    }
    unbind()
    if (legacyId >= 0) {
      try {
        wifiManager()?.removeNetwork(legacyId)
      } catch (e: Exception) {
      }
      legacyId = -1
    }
    legacyNetwork = null
    joined = false
    ssid = null
  }

  // MARK: Android 10 and later

  @TargetApi(Build.VERSION_CODES.Q)
  private fun joinWithSpecifier(ssid: String, password: String, shot: OneShot) {
    val cm = connectivity()
    if (cm == null) {
      failed(shot, ssid, "Android has no network service.")
      pending = null
      return
    }
    val request = try {
      val spec = WifiNetworkSpecifier.Builder().setSsid(ssid).apply {
        if (password.isNotEmpty()) setWpa2Passphrase(password)
      }.build()
      NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .setNetworkSpecifier(spec)
        .build()
    } catch (e: IllegalArgumentException) {
      failed(shot, ssid, "The Wi-Fi name or password is not correct.")
      pending = null
      return
    }
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        main.post {
          if (callback !== this) return@post
          bind(network)
          joined = true
          shot.resolve()
          if (pending === shot) pending = null
          emit("onWifi", mapOf("state" to "joined", "ssid" to ssid))
        }
      }

      override fun onUnavailable() {
        main.post {
          if (callback !== this) return@post
          callback = null
          try {
            cm.unregisterNetworkCallback(this)
          } catch (e: IllegalArgumentException) {
          }
          if (pending === shot) pending = null
          failed(shot, ssid, "Could not join $ssid. The network is not near, or the request was canceled.")
        }
      }

      override fun onLost(network: Network) {
        main.post {
          if (callback !== this) return@post
          if (bound == network) unbind()
          if (joined) {
            joined = false
            emit("onWifi", mapOf("state" to "lost", "ssid" to ssid))
          }
        }
      }
    }
    callback = cb
    try {
      cm.requestNetwork(request, cb)
    } catch (e: Exception) {
      callback = null
      pending = null
      failed(shot, ssid, "Android did not allow the Wi-Fi request: ${e.message}")
    }
  }

  // MARK: Android 9

  @Suppress("DEPRECATION")
  private fun joinLegacy(ssid: String, password: String, shot: OneShot) {
    val wm = wifiManager()
    val cm = connectivity()
    if (wm == null || cm == null) {
      pending = null
      failed(shot, ssid, "Wi-Fi is not available.")
      return
    }
    try {
      if (!wm.isWifiEnabled) wm.setWifiEnabled(true)
    } catch (e: Exception) {
    }
    val quoted = "\"$ssid\""
    val config = WifiConfiguration()
    config.SSID = quoted
    if (password.isEmpty()) {
      config.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
    } else {
      config.preSharedKey = "\"$password\""
    }
    val id = try {
      wm.addNetwork(config)
    } catch (e: Exception) {
      -1
    }
    if (id < 0) {
      pending = null
      failed(shot, ssid, "Android did not add the Wi-Fi network $ssid.")
      return
    }
    legacyId = id
    try {
      wm.disconnect()
      wm.enableNetwork(id, true)
      wm.reconnect()
    } catch (e: Exception) {
      Log.w(TAG, "Wi-Fi enable failed", e)
    }

    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        main.post { if (callback === this) legacyNetwork = network }
      }

      override fun onLost(network: Network) {
        main.post {
          if (callback !== this || legacyNetwork != network) return@post
          legacyNetwork = null
          if (bound == network) unbind()
          if (joined) {
            joined = false
            emit("onWifi", mapOf("state" to "lost", "ssid" to ssid))
          }
        }
      }
    }
    callback = cb
    try {
      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build()
      cm.registerNetworkCallback(request, cb)
    } catch (e: Exception) {
      Log.w(TAG, "No Wi-Fi network callback", e)
    }

    val deadline = System.currentTimeMillis() + LEGACY_TIMEOUT_MS
    val poll = object : Runnable {
      override fun run() {
        if (pending !== shot || callback !== cb) return
        val info = try {
          wm.connectionInfo
        } catch (e: Exception) {
          null
        }
        // Without location, the SSID can be "<unknown ssid>": the network id also tells.
        val onIt = info != null && (info.networkId == id || info.ssid == quoted) && info.ipAddress != 0
        val network = legacyNetwork
        if (onIt && network != null) {
          bind(network)
          joined = true
          pending = null
          shot.resolve()
          emit("onWifi", mapOf("state" to "joined", "ssid" to ssid))
          return
        }
        if (System.currentTimeMillis() > deadline) {
          pending = null
          failed(shot, ssid, "Could not join $ssid in time.")
          leaveNow()
          return
        }
        main.postDelayed(this, LEGACY_POLL_MS)
      }
    }
    main.postDelayed(poll, LEGACY_POLL_MS)
  }
}
