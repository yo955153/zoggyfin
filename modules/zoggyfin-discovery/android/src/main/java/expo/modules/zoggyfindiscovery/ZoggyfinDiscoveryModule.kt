// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfindiscovery

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/**
 * Jellyfin's discovery protocol: a UDP datagram "who is JellyfinServer?" to
 * port 7359 on the broadcast addresses. Each server answers with JSON
 * (`Address`, `Id`, `Name`, `EndpointAddress`). JavaScript parses the answers.
 *
 * Wi-Fi drivers drop broadcast and multicast packets to save power, so the
 * module holds a `WifiManager.MulticastLock` while it listens.
 */
class ZoggyfinDiscoveryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZoggyfinDiscovery")

    /** True: Android sends broadcasts with no special permission. */
    Constant("udpSupported") { true }

    /** The IPv4 addresses of the device that are up, with their prefix lengths. */
    Function("interfaces") { interfaces() }

    /** Android has no local network prompt. */
    AsyncFunction("localNetworkAccess") { _: Int -> "granted" }

    /** Sends the discovery datagram and collects the answers for `timeoutMs`. The raw JSON texts. */
    AsyncFunction("discover") { timeoutMs: Int ->
      discover(timeoutMs.coerceIn(200, 10_000))
    }.runOnQueue(Queues.DEFAULT)
  }

  private fun context(): Context? = appContext.reactContext?.applicationContext

  private fun ipv4Interfaces(): List<Triple<String, Inet4Address, Int>> {
    val out = mutableListOf<Triple<String, Inet4Address, Int>>()
    try {
      for (nif in NetworkInterface.getNetworkInterfaces() ?: return out) {
        if (!nif.isUp || nif.isLoopback) continue
        for (ia in nif.interfaceAddresses) {
          val a = ia.address
          if (a is Inet4Address) out.add(Triple(nif.name, a, ia.networkPrefixLength.toInt()))
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Cannot read the network interfaces", e)
    }
    return out
  }

  private fun interfaces(): List<Map<String, Any>> =
    ipv4Interfaces().map { (name, a, prefix) -> mapOf("name" to name, "address" to (a.hostAddress ?: ""), "prefix" to prefix) }

  /** The directed broadcast address of each interface (for example 192.0.2.255 for a /24). */
  private fun broadcastAddresses(): List<InetAddress> {
    val out = mutableListOf<InetAddress>(InetAddress.getByName("255.255.255.255"))
    for (nif in NetworkInterface.getNetworkInterfaces() ?: return out) {
      if (!nif.isUp || nif.isLoopback) continue
      for (ia in nif.interfaceAddresses) {
        val b = ia.broadcast ?: continue
        if (out.none { it == b }) out.add(b)
      }
    }
    return out
  }

  private fun discover(timeoutMs: Int): List<String> {
    val wifi = context()?.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    val lock = wifi?.createMulticastLock("zoggyfin-discovery")?.apply { setReferenceCounted(false) }
    val answers = LinkedHashSet<String>()
    try {
      lock?.acquire()
      DatagramSocket(null).use { socket ->
        socket.reuseAddress = true
        socket.broadcast = true
        socket.bind(InetSocketAddress(0))
        val message = QUESTION.toByteArray(Charsets.UTF_8)
        for (target in try { broadcastAddresses() } catch (e: Exception) { listOf(InetAddress.getByName("255.255.255.255")) }) {
          try {
            socket.send(DatagramPacket(message, message.size, target, PORT))
          } catch (e: Exception) {
            Log.w(TAG, "Cannot send to $target", e)
          }
        }
        val deadline = System.currentTimeMillis() + timeoutMs
        val buffer = ByteArray(4096)
        while (true) {
          val left = deadline - System.currentTimeMillis()
          if (left <= 0) break
          socket.soTimeout = left.toInt().coerceAtLeast(1)
          val packet = DatagramPacket(buffer, buffer.size)
          try {
            socket.receive(packet)
          } catch (e: SocketTimeoutException) {
            break
          }
          val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8).trim()
          // Our own datagram comes back on some networks.
          if (text.isNotEmpty() && text != QUESTION && answers.size < MAX_ANSWERS) answers.add(text)
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Discovery failed", e)
    } finally {
      try {
        lock?.release()
      } catch (_: Exception) {
      }
    }
    return answers.toList()
  }

  companion object {
    private const val TAG = "ZoggyfinDiscovery"
    private const val QUESTION = "who is JellyfinServer?"
    private const val PORT = 7359
    private const val MAX_ANSWERS = 64
  }
}
