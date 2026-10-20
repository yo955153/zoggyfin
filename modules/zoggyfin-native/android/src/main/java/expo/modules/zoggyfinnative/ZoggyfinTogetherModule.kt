// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.Manifest
import android.annotation.TargetApi
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.util.Log
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private const val SERVICE_TYPE = "_zgf-together._tcp"
private const val MAX_FRAME = 1_048_576L
private const val MAX_HEAD = 64 * 1024
private const val BODY_CHUNK = 256 * 1024
private const val CONNECT_TIMEOUT_MS = 10_000
private const val FIRST_BYTES_TIMEOUT_MS = 15_000
private const val HTTP_IDLE_TIMEOUT_MS = 30_000
/** HTTP connections from one guest (one address) at most: a new one closes the oldest. */
private const val MAX_HTTP_PER_GUEST = 3
/** HTTP connections in all at most. */
private const val MAX_HTTP_TOTAL = 32
/** The IP TOS of a control socket: DSCP EF (46), which Wi-Fi maps to the WMM voice queue. */
private const val CONTROL_TRAFFIC_CLASS = 0xB8
/** A paced response sends this many seconds of media at once (the player's start buffer), then `PACE_FACTOR` x the bitrate. */
private const val PACE_BURST_SECONDS = 10.0
private const val PACE_FACTOR = 1.5
private const val NEARBY_WIFI_DEVICES = "android.permission.NEARBY_WIFI_DEVICES"
private val MAGIC = byteArrayOf('Z'.code.toByte(), 'G'.code.toByte(), 'F'.code.toByte(), '1'.code.toByte())

/** An error that JavaScript gets as a promise rejection with a code. */
internal class TogetherException(code: String, message: String) : CodedException(code, message, null)

private fun namedThreads(prefix: String): ThreadFactory {
  val n = AtomicInteger()
  return ThreadFactory { r -> Thread(r, "$prefix-${n.incrementAndGet()}").apply { isDaemon = true } }
}

private fun closeQuietly(s: Socket?) {
  try {
    s?.close()
  } catch (_: IOException) {
  }
}

/**
 * Nearby "Watch together" transport for Android. It implements the
 * contract in `src/together/link-native-types.ts`:
 * - NSD (DNS-SD) to advertise and find `_zgf-together._tcp`;
 * - one TCP port per session: control sockets ("ZGF1" + length-prefixed
 *   frames) and a small HTTP range server for shared files;
 * - the local-only hotspot, Bluetooth LE rendezvous (NearbyBle.kt) and the
 *   Wi-Fi join (NearbyWifi.kt).
 *
 * Threads: blocking socket work runs on the `io` pool (one thread for each
 * socket reader and for each HTTP connection). NSD state changes only on the
 * single `state` thread. Hotspot calls run on the main thread. No function
 * blocks the JavaScript thread.
 */
class ZoggyfinTogetherModule : Module() {
  private val io: ExecutorService = Executors.newCachedThreadPool(namedThreads("zgf-together-io"))
  private val state: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor(namedThreads("zgf-together-state"))
  private val main = Handler(Looper.getMainLooper())
  private val random = SecureRandom()

  // Host
  private val serverLock = Any()
  private var server: ServerSocket? = null
  private var registration: NsdManager.RegistrationListener? = null
  private val shares = ConcurrentHashMap<String, Share>()
  /** The open HTTP sockets, with their order of arrival (for the connection limit). */
  private val httpSockets = ConcurrentHashMap<Socket, Long>()
  private val httpSerial = AtomicLong(0)
  private val served = AtomicLong(0)
  private val requests = AtomicLong(0)

  // Both
  private val sockets = ConcurrentHashMap<String, ControlSocket>()

  // Guest (NSD fields change only on `state`)
  private var discovery: NsdManager.DiscoveryListener? = null
  private var browseGeneration = 0
  private val resolveQueue = ArrayDeque<PendingResolve>()
  private var resolvingToken: Any? = null
  private var resolvingName: String? = null
  private val reported = HashSet<String>()
  private val resolved = ConcurrentHashMap<String, Resolved>()
  private var multicastLock: WifiManager.MulticastLock? = null

  // Hotspot (main thread). The types are API 26, so the fields keep `Any`.
  @Volatile private var hotspotReservation: Any? = null
  @Volatile private var hotspotCallback: Any? = null

  @Volatile private var bleHelper: NearbyBle? = null
  @Volatile private var wifiHelper: NearbyWifi? = null

  /** `rate`: the file's bitrate in bytes per second for the pace of its responses, or 0 for no pace. */
  private data class Share(val path: String, val mime: String, val rate: Double = 0.0)

  private data class PendingResolve(val info: NsdServiceInfo, val tries: Int)

  private data class Resolved(val name: String, val addresses: List<InetAddress>, val port: Int, val txt: Map<String, String>) {
    fun ipv4(): Inet4Address? = addresses.firstOrNull { it is Inet4Address } as Inet4Address?

    fun best(): InetAddress? = ipv4() ?: addresses.firstOrNull()
  }

  override fun definition() = ModuleDefinition {
    Name("ZoggyfinTogether")

    Events(
      "onServiceFound",
      "onServiceLost",
      "onSocketOpen",
      "onFrame",
      "onSocketClosed",
      "onError",
      "onHotspot",
      "onBleState",
      "onBlePeer",
      "onBlePeerLost",
      "onBleConnected",
      "onBleMessage",
      "onBleDisconnected",
      "onWifi"
    )

    Constant("platform") { "android" }

    /** Milliseconds since boot (deep sleep included). `receivedAt` uses the same clock. */
    Function("monotonicNow") { now() }

    /** `n` random bytes (1 to 1024) from SecureRandom, as base64. */
    Function("randomBytes") { n: Int ->
      val bytes = ByteArray(n.coerceIn(1, 1024))
      random.nextBytes(bytes)
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    // Host

    AsyncFunction("startServer") { serviceName: String, txt: Map<String, String>, promise: Promise ->
      io.execute { startServerNow(serviceName, txt, promise) }
    }

    Function("stopAdvertising") {
      state.execute { unregisterAdvert() }
    }

    Function("shareFile") { urlPath: String, filePath: String, mimeType: String ->
      shares[urlPath] = Share(localPath(filePath), mimeType)
    }

    /** Paces the responses of a shared file to its bitrate (bytes per second; 0 removes the pace). */
    Function("setPace") { urlPath: String, bytesPerSecond: Double ->
      shares.computeIfPresent(urlPath) { _, s -> s.copy(rate = if (bytesPerSecond > 0) bytesPerSecond else 0.0) }
    }

    Function("unshareAll") {
      shares.clear()
    }

    Function("stopServer") {
      stopServerNow()
    }

    // Guest

    Function("startBrowsing") {
      state.execute { startBrowsingNow() }
    }

    Function("stopBrowsing") {
      state.execute { stopBrowsingNow() }
    }

    Function("connect") { serviceId: String ->
      val c = newControlSocket(inbound = false)
      runIo(c) {
        val target = resolved[serviceId]
        val address = target?.best()
        if (target == null || address == null) {
          c.close("The service $serviceId is not known.")
        } else {
          openOutbound(c, InetSocketAddress(address, target.port))
        }
      }
      c.id
    }

    Function("connectAddress") { host: String, port: Int ->
      val c = newControlSocket(inbound = false)
      runIo(c) {
        try {
          openOutbound(c, InetSocketAddress(host, port))
        } catch (e: IllegalArgumentException) {
          c.close("The address $host:$port is not correct.")
        }
      }
      c.id
    }

    AsyncFunction("mediaBase") { serviceId: String?, host: String?, port: Int ->
      mediaBaseNow(serviceId, host, port)
    }

    /** Android has no relay: the player reads the host's address directly. */
    Function("stopRelay") {}

    // Both

    Function("send") { socketId: String, text: String ->
      sockets[socketId]?.send(text) ?: false
    }

    /** One text to several sockets (a broadcast) in one call from JavaScript. */
    Function("sendMany") { socketIds: List<String>, text: String ->
      for (id in socketIds) sockets[id]?.send(text)
    }

    /** Host: a pong to a ping. The writer thread stamps `t2` right before the frame goes out. */
    Function("sendPong") { socketId: String, id: Double, t0: Double, t1: Double ->
      if (id.isFinite() && t0.isFinite() && t1.isFinite()) {
        sockets[socketId]?.sendLate { "{\"v\":1,\"t\":\"pong\",\"id\":${id.toLong()},\"t0\":$t0,\"t1\":$t1,\"t2\":${now()}}" } ?: false
      } else {
        false
      }
    }

    Function("close") { socketId: String ->
      sockets[socketId]?.let { c -> io.execute { c.close(null) } }
    }

    AsyncFunction("addresses") {
      addressesNow()
    }

    Function("stopAll") {
      stopAllNow()
    }

    Function("mediaStats") {
      mapOf("served" to served.get().toDouble(), "requests" to requests.get().toDouble(), "relayed" to 0.0)
    }

    // Hotspot

    AsyncFunction("startHotspot") { promise: Promise ->
      startHotspot(promise)
    }

    Function("stopHotspot") {
      main.post { stopHotspotNow() }
    }

    // Bluetooth LE

    AsyncFunction("bleState") {
      ble().state()
    }

    AsyncFunction("bleRequestPermission") { promise: Promise ->
      val b = ble()
      askPermissions(b.requiredPermissions()) { _ -> promise.resolve(b.state()) }
    }

    Function("bleAdvertise") { info: String, localName: String ->
      ble().advertise(info, localName)
    }

    Function("bleStopAdvertising") {
      ble().stopAdvertising()
    }

    Function("bleScan") {
      ble().scan()
    }

    Function("bleStopScan") {
      ble().stopScan()
    }

    Function("bleSend") { peerId: String, text: String ->
      ble().send(peerId, text)
    }

    Function("bleDisconnect") { peerId: String ->
      ble().disconnect(peerId)
    }

    Function("bleStopAll") {
      ble().stopAll()
    }

    // Wi-Fi join

    AsyncFunction("joinWifi") { ssid: String, password: String, promise: Promise ->
      wifi().join(ssid, password, promise)
    }

    Function("leaveWifi") { ssid: String ->
      wifi().leave(ssid)
    }

    Function("openSettings") {
      openAppSettings()
    }

    OnCreate {
      // This only listens for Bluetooth on and off. It asks for nothing.
      ble().attach()
    }

    OnDestroy {
      stopAllNow()
      main.post { stopHotspotNow() }
      bleHelper?.dispose()
      wifiHelper?.dispose()
      state.execute { releaseMulticast() }
      state.shutdown()
      io.shutdown()
    }
  }

  // MARK: Helpers

  private fun now(): Double = SystemClock.elapsedRealtimeNanos() / 1e6

  private fun context(): Context? = appContext.reactContext?.applicationContext

  private fun nsd(): NsdManager? = context()?.getSystemService(Context.NSD_SERVICE) as NsdManager?

  private fun wifiManager(): WifiManager? = context()?.getSystemService(Context.WIFI_SERVICE) as WifiManager?

  private fun emit(name: String, body: Map<String, Any?>) {
    try {
      sendEvent(name, body)
    } catch (e: Exception) {
      Log.w(TAG, "Could not send $name", e)
    }
  }

  private fun emitError(message: String, code: String) {
    emit("onError", mapOf("message" to message, "code" to code))
  }

  private fun ble(): NearbyBle {
    bleHelper?.let { return it }
    synchronized(this) {
      val b = bleHelper ?: NearbyBle({ context() }, { n, b -> emit(n, b) })
      bleHelper = b
      return b
    }
  }

  private fun wifi(): NearbyWifi {
    wifiHelper?.let { return it }
    synchronized(this) {
      val w = wifiHelper ?: NearbyWifi({ context() }, { n, b -> emit(n, b) })
      wifiHelper = w
      return w
    }
  }

  /** A "file://" URI becomes a plain path; percent escapes are decoded. */
  private fun localPath(filePath: String): String {
    if (!filePath.startsWith("file:")) return filePath
    return Uri.parse(filePath).path ?: filePath.removePrefix("file://")
  }

  private fun runIo(c: ControlSocket, body: () -> Unit) {
    try {
      io.execute { body() }
    } catch (e: RejectedExecutionException) {
      c.close("The module is closed.")
    }
  }

  /**
   * Asks for runtime permissions through Expo. The callback gets the set of
   * granted permissions. It never throws.
   */
  private fun askPermissions(permissions: Array<String>, done: (Set<String>) -> Unit) {
    val manager = appContext.permissions
    if (permissions.isEmpty() || manager == null) {
      val ctx = context()
      done(permissions.filter { ctx?.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED }.toSet())
      return
    }
    try {
      ZoggyfinAndroidModule.holdPictureInPicture()
      manager.askForPermissions(
        PermissionsResponseListener { result ->
          done(result.filter { it.value.status == PermissionsStatus.GRANTED }.keys.toSet())
        },
        *permissions
      )
    } catch (e: IllegalStateException) {
      // Another request is open. Report what is granted now.
      val ctx = context()
      done(permissions.filter { ctx?.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED }.toSet())
    }
  }

  private fun openAppSettings() {
    val ctx = context() ?: return
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ZoggyfinAndroidModule.holdPictureInPicture()
      val activity = appContext.currentActivity
      if (activity != null) activity.startActivity(intent) else ctx.startActivity(intent)
    } catch (e: Exception) {
      Log.w(TAG, "Could not open the app settings", e)
    }
  }

  // MARK: Host: server and advert

  private fun startServerNow(name: String, txt: Map<String, String>, promise: Promise) {
    val nsd = nsd()
    if (nsd == null) {
      promise.reject("ERR_SERVER", "Network service discovery is not available.", null)
      return
    }
    val port: Int = try {
      synchronized(serverLock) {
        val current = server
        if (current != null && !current.isClosed) {
          current.localPort
        } else {
          val s = ServerSocket()
          s.reuseAddress = true
          // Port 0 on the wildcard address: all interfaces, the hotspot too.
          s.bind(InetSocketAddress(0))
          server = s
          io.execute { acceptLoop(s) }
          s.localPort
        }
      }
    } catch (e: Exception) {
      promise.reject("ERR_SERVER", "Could not open the session port: ${e.message}", e)
      return
    }

    val info = NsdServiceInfo()
    info.serviceName = name
    info.serviceType = SERVICE_TYPE
    info.port = port
    try {
      for ((k, v) in txt) info.setAttribute(k, v)
    } catch (e: IllegalArgumentException) {
      promise.reject("ERR_SERVER", "A TXT record entry is not correct: ${e.message}", e)
      return
    }

    val done = AtomicBoolean(false)
    val listener = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(registered: NsdServiceInfo) {
        // NSD can change the name when the name is in use.
        val real = registered.serviceName ?: name
        if (done.compareAndSet(false, true)) promise.resolve(mapOf("port" to port, "service" to real))
      }

      override fun onRegistrationFailed(failed: NsdServiceInfo, errorCode: Int) {
        val me = this
        state.execute { if (registration === me) registration = null }
        val message = "Could not advertise the session (NSD error $errorCode)."
        if (done.compareAndSet(false, true)) {
          promise.reject("ERR_SERVER", message, null)
        } else {
          emitError(message, "server")
        }
      }

      override fun onServiceUnregistered(unregistered: NsdServiceInfo) {}

      override fun onUnregistrationFailed(unregistered: NsdServiceInfo, errorCode: Int) {}
    }

    state.execute {
      unregisterAdvert()
      registration = listener
      try {
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
      } catch (e: Exception) {
        registration = null
        if (done.compareAndSet(false, true)) promise.reject("ERR_SERVER", "Could not advertise the session: ${e.message}", e)
      }
      state.schedule(Runnable {
        if (done.compareAndSet(false, true)) {
          promise.reject("ERR_SERVER", "The session advert did not start in time.", null)
        }
      }, 15, TimeUnit.SECONDS)
    }
  }

  /** Call on `state`. */
  private fun unregisterAdvert() {
    val l = registration ?: return
    registration = null
    try {
      nsd()?.unregisterService(l)
    } catch (e: IllegalArgumentException) {
      // The listener is not registered (it failed or was removed before).
    }
  }

  private fun acceptLoop(ss: ServerSocket) {
    while (!ss.isClosed) {
      val s = try {
        ss.accept()
      } catch (e: IOException) {
        break
      }
      try {
        io.execute { route(s) }
      } catch (e: RejectedExecutionException) {
        closeQuietly(s)
        break
      }
    }
    val unexpected = synchronized(serverLock) { server === ss && !ss.isClosed }
    if (unexpected) emitError("The session port stopped.", "server")
  }

  /** Reads the first 4 bytes. "ZGF1" makes a control socket; other bytes start HTTP. */
  private fun route(s: Socket) {
    try {
      s.soTimeout = FIRST_BYTES_TIMEOUT_MS
      val input = s.getInputStream()
      val head = ByteArray(4)
      var n = 0
      while (n < 4) {
        val r = input.read(head, n, 4 - n)
        if (r < 0) {
          closeQuietly(s)
          return
        }
        n += r
      }
      if (head.contentEquals(MAGIC)) {
        s.soTimeout = 0
        s.tcpNoDelay = true
        setControlClass(s)
        val c = newControlSocket(inbound = true)
        if (!c.attach(s)) return
        emit("onSocketOpen", mapOf("socketId" to c.id, "inbound" to true))
        c.readLoop(s)
      } else {
        serveHttp(s, head)
      }
    } catch (e: IOException) {
      closeQuietly(s)
    }
  }

  private fun stopServerNow() {
    val s = synchronized(serverLock) {
      val old = server
      server = null
      old
    }
    try {
      s?.close()
    } catch (_: IOException) {
    }
    try {
      state.execute { unregisterAdvert() }
    } catch (_: RejectedExecutionException) {
    }
    shares.clear()
    for (h in httpSockets.keys.toList()) closeQuietly(h)
    httpSockets.clear()
    for (c in sockets.values.toList()) {
      if (c.inbound) c.close(null)
    }
  }

  private fun stopAllNow() {
    stopServerNow()
    try {
      state.execute {
        stopBrowsingNow()
        resolved.clear()
      }
    } catch (_: RejectedExecutionException) {
    }
    for (c in sockets.values.toList()) c.close(null)
  }

  // MARK: Control sockets

  /** The WMM voice class for a control socket, so pings and the group state do not wait behind media. */
  private fun setControlClass(s: Socket) {
    try {
      s.trafficClass = CONTROL_TRAFFIC_CLASS
    } catch (e: Exception) {
      // Some networks or IPv6 sockets refuse it: the socket works with the default class.
    }
  }

  private fun newControlSocket(inbound: Boolean): ControlSocket {
    val c = ControlSocket(UUID.randomUUID().toString(), inbound)
    sockets[c.id] = c
    return c
  }

  private fun openOutbound(c: ControlSocket, address: InetSocketAddress) {
    val s = Socket()
    if (!c.attach(s)) return
    setControlClass(s)
    try {
      s.connect(address, CONNECT_TIMEOUT_MS)
      s.tcpNoDelay = true
      val out = s.getOutputStream()
      out.write(MAGIC)
      out.flush()
    } catch (e: IOException) {
      c.close(e.message ?: "Could not connect.")
      return
    }
    if (c.isClosed()) return
    c.markOpen()
    emit("onSocketOpen", mapOf("socketId" to c.id, "inbound" to false))
    c.readLoop(s)
  }

  /**
   * One control socket. A reader thread reads frames; a single writer thread
   * writes them in order. `close` runs once and sends `onSocketClosed` once.
   */
  private inner class ControlSocket(val id: String, val inbound: Boolean) {
    @Volatile private var socket: Socket? = null
    @Volatile private var open = false
    private val closed = AtomicBoolean(false)
    private val writer = Executors.newSingleThreadExecutor(namedThreads("zgf-together-write"))

    fun isClosed() = closed.get()

    /** Keeps the socket, so that `close` can stop a connect. False when closed already. */
    fun attach(s: Socket): Boolean {
      socket = s
      if (inbound) open = true
      if (closed.get()) {
        closeQuietly(s)
        return false
      }
      return true
    }

    fun markOpen() {
      open = true
    }

    fun send(text: String): Boolean {
      if (closed.get() || !open) return false
      val bytes = text.toByteArray(Charsets.UTF_8)
      if (bytes.isEmpty() || bytes.size > MAX_FRAME) return false
      return write { frameOf(bytes) }
    }

    /** Sends a text that the writer thread makes right before it writes (a pong's send time). */
    fun sendLate(make: () -> String): Boolean {
      if (closed.get() || !open) return false
      return write { frameOf(make().toByteArray(Charsets.UTF_8)) }
    }

    private fun frameOf(bytes: ByteArray): ByteArray {
      val frame = ByteArray(4 + bytes.size)
      val n = bytes.size
      frame[0] = (n ushr 24).toByte()
      frame[1] = (n ushr 16).toByte()
      frame[2] = (n ushr 8).toByte()
      frame[3] = n.toByte()
      System.arraycopy(bytes, 0, frame, 4, n)
      return frame
    }

    private fun write(frame: () -> ByteArray): Boolean {
      val s = socket ?: return false
      return try {
        writer.execute {
          try {
            val out: OutputStream = s.getOutputStream()
            out.write(frame())
            out.flush()
          } catch (e: IOException) {
            close(e.message ?: "Could not send.")
          }
        }
        true
      } catch (e: RejectedExecutionException) {
        false
      }
    }

    fun readLoop(s: Socket) {
      val header = ByteArray(4)
      try {
        val input = DataInputStream(BufferedInputStream(s.getInputStream(), 64 * 1024))
        while (!closed.get()) {
          input.readFully(header)
          val n = ((header[0].toLong() and 0xff) shl 24) or
            ((header[1].toLong() and 0xff) shl 16) or
            ((header[2].toLong() and 0xff) shl 8) or
            (header[3].toLong() and 0xff)
          if (n < 1 || n > MAX_FRAME) {
            close("The frame length $n is not correct.")
            return
          }
          val payload = ByteArray(n.toInt())
          input.readFully(payload)
          val at = now()
          emit("onFrame", mapOf("socketId" to id, "text" to String(payload, Charsets.UTF_8), "receivedAt" to at))
        }
      } catch (e: EOFException) {
        close("The other device closed the connection.")
      } catch (e: IOException) {
        close(e.message ?: "The connection failed.")
      }
    }

    fun close(reason: String?) {
      if (!closed.compareAndSet(false, true)) return
      open = false
      sockets.remove(id)
      closeQuietly(socket)
      writer.shutdown()
      emit("onSocketClosed", mapOf("socketId" to id, "reason" to reason))
    }
  }

  // MARK: HTTP range server

  /** Serves requests one after the other on one connection (keep-alive). */
  private fun serveHttp(s: Socket, prefix: ByteArray) {
    limitHttp(s.inetAddress)
    httpSockets[s] = httpSerial.incrementAndGet()
    try {
      s.soTimeout = HTTP_IDLE_TIMEOUT_MS
      val input = s.getInputStream()
      val out = BufferedOutputStream(s.getOutputStream(), 64 * 1024)
      val buf = ByteArray(MAX_HEAD + 8 * 1024)
      System.arraycopy(prefix, 0, buf, 0, prefix.size)
      var len = prefix.size
      while (true) {
        val end = headEnd(buf, len)
        if (end < 0) {
          if (len > MAX_HEAD || len >= buf.size) return
          val r = input.read(buf, len, buf.size - len)
          if (r < 0) return
          len += r
          continue
        }
        val head = String(buf, 0, end, Charsets.UTF_8)
        val rest = len - (end + 4)
        System.arraycopy(buf, end + 4, buf, 0, rest)
        len = rest
        if (!handleRequest(head, out)) return
      }
    } catch (e: IOException) {
      // The client went away.
    } finally {
      httpSockets.remove(s)
      closeQuietly(s)
    }
  }

  /**
   * Makes room for one more HTTP connection from `remote`: closes the oldest one of that
   * guest past MAX_HTTP_PER_GUEST, and the oldest of all past MAX_HTTP_TOTAL. A player that
   * seeks opens a new connection and leaves the old one, so the oldest is the one to go.
   */
  private fun limitHttp(remote: InetAddress?) {
    // This device's own clients (loopback) are not guests.
    if (remote == null || remote.isLoopbackAddress) return
    val live = httpSockets.entries.filter { !it.key.isClosed }.sortedBy { it.value }
    val mine = live.filter { it.key.inetAddress == remote }
    for (e in mine.take(maxOf(0, mine.size - (MAX_HTTP_PER_GUEST - 1)))) closeQuietly(e.key)
    val rest = live.filter { !it.key.isClosed }
    for (e in rest.take(maxOf(0, rest.size - (MAX_HTTP_TOTAL - 1)))) closeQuietly(e.key)
  }

  /** The index of "\r\n\r\n" in the first `len` bytes, or -1. */
  private fun headEnd(buf: ByteArray, len: Int): Int {
    var i = 0
    while (i + 3 < len) {
      if (buf[i] == '\r'.code.toByte() && buf[i + 1] == '\n'.code.toByte() &&
        buf[i + 2] == '\r'.code.toByte() && buf[i + 3] == '\n'.code.toByte()
      ) {
        return i
      }
      i++
    }
    return -1
  }

  /** Answers one request. False closes the connection. */
  private fun handleRequest(head: String, out: OutputStream): Boolean {
    requests.incrementAndGet()
    val lines = head.split("\r\n")
    val parts = lines.first().split(" ").filter { it.isNotEmpty() }
    if (parts.size < 2) return respond(out, "400 Bad Request")
    val method = parts[0]
    val path = parts[1].substringBefore('?')
    val headers = HashMap<String, String>()
    for (line in lines.drop(1)) {
      val colon = line.indexOf(':')
      if (colon < 0) continue
      headers[line.substring(0, colon).lowercase()] = line.substring(colon + 1).trim()
    }
    if (method != "GET" && method != "HEAD") return respond(out, "405 Method Not Allowed")
    val share = shares[path] ?: return respond(out, "404 Not Found")
    val file = File(share.path)
    if (!file.isFile) return respond(out, "404 Not Found")
    val size = file.length()

    var start = 0L
    var end = size - 1
    var partial = false
    val range = headers["range"]
    if (range != null) {
      val parsed = parseRange(range, size)
        ?: return respond(out, "416 Range Not Satisfiable", mapOf("Content-Range" to "bytes */$size"))
      start = parsed.first
      end = parsed.second
      partial = true
    }
    val length = if (size == 0L) 0L else end - start + 1
    val fields = linkedMapOf(
      "Content-Type" to share.mime,
      "Content-Length" to length.toString(),
      "Accept-Ranges" to "bytes",
      "Connection" to "keep-alive"
    )
    if (partial) fields["Content-Range"] = "bytes $start-$end/$size"
    writeHead(out, if (partial) "206 Partial Content" else "200 OK", fields)
    if (method == "HEAD" || length == 0L) {
      out.flush()
      return true
    }
    val rate = share.rate
    val paceStart = SystemClock.elapsedRealtime()
    var sent = 0L
    RandomAccessFile(file, "r").use { raf ->
      raf.seek(start)
      val chunk = ByteArray(BODY_CHUNK)
      var remaining = length
      while (remaining > 0) {
        val want = if (remaining < BODY_CHUNK) remaining.toInt() else BODY_CHUNK
        if (rate > 0) {
          // A token bucket: the first seconds of media at once, then PACE_FACTOR x the bitrate.
          val elapsed = (SystemClock.elapsedRealtime() - paceStart) / 1000.0
          val over = sent + want - (rate * PACE_BURST_SECONDS + rate * PACE_FACTOR * elapsed)
          if (over > 0) {
            out.flush()
            try {
              Thread.sleep(minOf(5_000L, (over / (rate * PACE_FACTOR) * 1000).toLong() + 1))
            } catch (e: InterruptedException) {
              Thread.currentThread().interrupt()
              return false
            }
          }
        }
        val n = raf.read(chunk, 0, want)
        if (n <= 0) {
          out.flush()
          return false
        }
        out.write(chunk, 0, n)
        served.addAndGet(n.toLong())
        sent += n
        remaining -= n
      }
    }
    out.flush()
    return true
  }

  private fun writeHead(out: OutputStream, status: String, fields: Map<String, String>) {
    val sb = StringBuilder("HTTP/1.1 ").append(status).append("\r\n")
    for ((k, v) in fields) sb.append(k).append(": ").append(v).append("\r\n")
    sb.append("\r\n")
    out.write(sb.toString().toByteArray(Charsets.UTF_8))
  }

  private fun respond(out: OutputStream, status: String, extra: Map<String, String> = emptyMap()): Boolean {
    val fields = LinkedHashMap(extra)
    fields["Content-Length"] = "0"
    fields["Connection"] = "keep-alive"
    writeHead(out, status, fields)
    out.flush()
    return true
  }

  /** "bytes=a-b", "bytes=a-" or "bytes=-n". Only one range. The same rules as MediaServer.swift. */
  internal fun parseRange(value: String, size: Long): Pair<Long, Long>? {
    if (!value.startsWith("bytes=") || size <= 0) return null
    val spec = value.substring(6).split(",").firstOrNull { it.isNotEmpty() } ?: ""
    val ends = spec.split("-").map { it.trim() }
    if (ends.size != 2) return null
    if (ends[0].isEmpty()) {
      val n = ends[1].toLongOrNull() ?: return null
      if (n <= 0) return null
      return Pair(maxOf(0L, size - n), size - 1)
    }
    val a = ends[0].toLongOrNull() ?: return null
    if (a >= size) return null
    val b = if (ends[1].isEmpty()) size - 1 else minOf(ends[1].toLongOrNull() ?: (size - 1), size - 1)
    if (b < a) return null
    return Pair(a, b)
  }

  // MARK: Guest: browse and resolve (all on `state`)

  private fun startBrowsingNow() {
    stopBrowsingNow()
    val nsd = nsd()
    if (nsd == null) {
      emitError("Network service discovery is not available.", "browse")
      return
    }
    acquireMulticast()
    val generation = ++browseGeneration
    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {}

      override fun onDiscoveryStopped(serviceType: String) {}

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        state.execute {
          if (generation == browseGeneration) {
            discovery = null
            releaseMulticast()
            emitError("Could not look for nearby sessions (NSD error $errorCode).", "browse")
          }
        }
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}

      override fun onServiceFound(info: NsdServiceInfo) {
        state.execute { if (generation == browseGeneration) enqueueResolve(info) }
      }

      override fun onServiceLost(info: NsdServiceInfo) {
        state.execute { if (generation == browseGeneration) serviceLost(info.serviceName ?: return@execute) }
      }
    }
    discovery = listener
    try {
      nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (e: Exception) {
      discovery = null
      releaseMulticast()
      emitError("Could not look for nearby sessions: ${e.message}", "browse")
    }
  }

  private fun stopBrowsingNow() {
    val l = discovery
    discovery = null
    browseGeneration++
    if (l != null) {
      try {
        nsd()?.stopServiceDiscovery(l)
      } catch (e: IllegalArgumentException) {
        // Discovery is not active.
      }
    }
    resolveQueue.clear()
    resolvingToken = null
    resolvingName = null
    reported.clear()
    releaseMulticast()
  }

  private fun enqueueResolve(info: NsdServiceInfo) {
    val name = info.serviceName ?: return
    if (resolvingName == name || resolveQueue.any { it.info.serviceName == name }) return
    resolveQueue.addLast(PendingResolve(info, 0))
    pumpResolve()
  }

  /**
   * Resolves one service at a time: before Android 14 NSD refuses a second
   * resolve while one runs (FAILURE_ALREADY_ACTIVE).
   */
  @Suppress("DEPRECATION")
  private fun pumpResolve() {
    if (resolvingToken != null) return
    val next = resolveQueue.removeFirstOrNull() ?: return
    val nsd = nsd() ?: return
    val generation = browseGeneration
    val token = Any()
    resolvingToken = token
    resolvingName = next.info.serviceName
    val listener = object : NsdManager.ResolveListener {
      override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
        state.execute {
          if (!finishResolve(token)) return@execute
          if (generation == browseGeneration && errorCode == NsdManager.FAILURE_ALREADY_ACTIVE && next.tries < 5) {
            state.schedule(Runnable {
              if (generation == browseGeneration) {
                resolveQueue.addFirst(next.copy(tries = next.tries + 1))
                pumpResolve()
              }
            }, 300, TimeUnit.MILLISECONDS)
          } else {
            pumpResolve()
          }
        }
      }

      override fun onServiceResolved(info: NsdServiceInfo) {
        state.execute {
          if (!finishResolve(token)) return@execute
          if (generation == browseGeneration) storeResolved(info)
          pumpResolve()
        }
      }
    }
    try {
      nsd.resolveService(next.info, listener)
    } catch (e: Exception) {
      finishResolve(token)
      state.schedule(Runnable { pumpResolve() }, 100, TimeUnit.MILLISECONDS)
      return
    }
    state.schedule(Runnable {
      if (resolvingToken === token) {
        finishResolve(token)
        if (Build.VERSION.SDK_INT >= 34) stopResolution(nsd, listener)
        pumpResolve()
      }
    }, 8, TimeUnit.SECONDS)
  }

  @TargetApi(34)
  private fun stopResolution(nsd: NsdManager, listener: NsdManager.ResolveListener) {
    try {
      nsd.stopServiceResolution(listener)
    } catch (e: IllegalArgumentException) {
      // The resolve is finished already.
    }
  }

  private fun finishResolve(token: Any): Boolean {
    if (resolvingToken !== token) return false
    resolvingToken = null
    resolvingName = null
    return true
  }

  @Suppress("DEPRECATION")
  private fun storeResolved(info: NsdServiceInfo) {
    val name = info.serviceName ?: return
    val addresses: List<InetAddress> = if (Build.VERSION.SDK_INT >= 34) {
      info.hostAddresses.toList()
    } else {
      listOfNotNull(info.host)
    }
    val txt = HashMap<String, String>()
    val attributes: Map<String, ByteArray?> = info.attributes ?: emptyMap()
    for ((k, v) in attributes) txt[k] = if (v == null) "" else String(v, Charsets.UTF_8)
    resolved[name] = Resolved(name, addresses, info.port, txt)
    reported.add(name)
    emit("onServiceFound", mapOf("serviceId" to name, "name" to name, "txt" to txt))
  }

  private fun serviceLost(name: String) {
    resolveQueue.removeAll { it.info.serviceName == name }
    // The address stays: a lost advert does not close an open session.
    if (reported.remove(name)) emit("onServiceLost", mapOf("serviceId" to name))
  }

  private fun acquireMulticast() {
    if (multicastLock?.isHeld == true) return
    try {
      val lock = wifiManager()?.createMulticastLock("zoggyfin-together") ?: return
      lock.setReferenceCounted(false)
      lock.acquire()
      multicastLock = lock
    } catch (e: SecurityException) {
      Log.w(TAG, "No multicast lock", e)
    }
  }

  private fun releaseMulticast() {
    try {
      multicastLock?.let { if (it.isHeld) it.release() }
    } catch (e: RuntimeException) {
      // The lock is released already.
    }
    multicastLock = null
  }

  private fun mediaBaseNow(serviceId: String?, host: String?, port: Int): String {
    if (serviceId != null) {
      val r = resolved[serviceId] ?: throw TogetherException("ERR_MEDIA_BASE", "The service $serviceId is not known.")
      val ip = r.ipv4()?.hostAddress ?: throw TogetherException("ERR_MEDIA_BASE", "The service $serviceId has no IPv4 address.")
      val p = if (port > 0) port else r.port
      return "http://$ip:$p"
    }
    if (host != null) {
      val ip = try {
        InetAddress.getAllByName(host).firstOrNull { it is Inet4Address }?.hostAddress
      } catch (e: IOException) {
        null
      } ?: throw TogetherException("ERR_MEDIA_BASE", "The host $host has no IPv4 address.")
      return "http://$ip:$port"
    }
    throw TogetherException("ERR_MEDIA_BASE", "Give a service id or a host.")
  }

  // MARK: Addresses

  private fun addressesNow(): List<Map<String, Any?>> {
    val station = stationWifiInterfaces()
    val hotspotOn = hotspotReservation != null
    val out = ArrayList<Map<String, Any?>>()
    val interfaces = try {
      NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
    } catch (e: Exception) {
      emptyList()
    }
    for (iface in interfaces) {
      val up = try {
        iface.isUp && !iface.isLoopback
      } catch (e: Exception) {
        false
      }
      if (!up) continue
      for (addr in iface.inetAddresses.toList()) {
        if (addr !is Inet4Address || addr.isLoopbackAddress) continue
        val ip = addr.hostAddress ?: continue
        out.add(mapOf("name" to iface.name, "address" to ip, "kind" to kindOf(iface.name, station, hotspotOn)))
      }
    }
    return out
  }

  /**
   * The names of the interfaces that connect this device to a Wi-Fi network
   * (station mode). Null when Android does not tell.
   */
  @Suppress("DEPRECATION")
  private fun stationWifiInterfaces(): Set<String>? {
    val cm = context()?.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager? ?: return null
    return try {
      val names = HashSet<String>()
      for (n in cm.allNetworks) {
        val caps = cm.getNetworkCapabilities(n) ?: continue
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue
        cm.getLinkProperties(n)?.interfaceName?.let { names.add(it) }
      }
      names
    } catch (e: Exception) {
      null
    }
  }

  private fun kindOf(name: String, station: Set<String>?, hotspotOn: Boolean): String {
    val n = name.lowercase()
    if (station != null && n in station.map { it.lowercase() }) return "wifi"
    if (n.startsWith("ap") || n.startsWith("swlan") || n.startsWith("softap")) return "hotspot"
    if (n.startsWith("eth")) return "ethernet"
    if (n.startsWith("p2p")) return "other"
    if (n.startsWith("wlan") || n.startsWith("wifi")) {
      // A Wi-Fi interface with an address that is not a station network makes a network.
      if (station != null && (hotspotOn || station.isNotEmpty() || n != "wlan0")) return "hotspot"
      return "wifi"
    }
    return "other"
  }

  // MARK: Local-only hotspot

  private fun startHotspot(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.reject("ERR_HOTSPOT", "This Android version cannot make a hotspot.", null)
      return
    }
    val ctx = context()
    if (ctx == null) {
      promise.reject("ERR_HOTSPOT", "The app is not ready.", null)
      return
    }
    val needed: String
    val ask: Array<String>
    when {
      Build.VERSION.SDK_INT >= 33 -> {
        needed = NEARBY_WIFI_DEVICES
        ask = arrayOf(NEARBY_WIFI_DEVICES)
      }
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
        // Android 12 ignores a request for fine location without coarse location.
        needed = Manifest.permission.ACCESS_FINE_LOCATION
        ask = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
      }
      else -> {
        needed = Manifest.permission.ACCESS_FINE_LOCATION
        ask = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
      }
    }
    askPermissions(ask) { granted ->
      if (needed !in granted) {
        val what = if (Build.VERSION.SDK_INT >= 33) "the Nearby devices permission" else "the precise location permission"
        promise.reject("ERR_HOTSPOT_PERMISSION", "Zoggyfin needs $what to make a hotspot.", null)
      } else if (Build.VERSION.SDK_INT < 33 && !locationOn(ctx)) {
        promise.reject("ERR_HOTSPOT_LOCATION", "Turn on Location to make a hotspot.", null)
      } else {
        main.post { startHotspotNow(promise) }
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun locationOn(ctx: Context): Boolean {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        (ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager?)?.isLocationEnabled ?: false
      } else {
        Settings.Secure.getInt(ctx.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF) !=
          Settings.Secure.LOCATION_MODE_OFF
      }
    } catch (e: Exception) {
      true
    }
  }

  /** Main thread. */
  @TargetApi(Build.VERSION_CODES.O)
  private fun startHotspotNow(promise: Promise) {
    val current = hotspotReservation as WifiManager.LocalOnlyHotspotReservation?
    if (current != null) {
      val (ssid, password) = credentials(current)
      promise.resolve(mapOf("ssid" to ssid, "password" to password))
      return
    }
    val wm = wifiManager()
    if (wm == null) {
      promise.reject("ERR_HOTSPOT", "Wi-Fi is not available.", null)
      return
    }
    val airplane = airplaneModeOn()
    if (airplane && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      // Android 8 to 10 drop every hotspot request in airplane mode with no callback (seen on Android 9).
      promise.reject("ERR_HOTSPOT_AIRPLANE", AIRPLANE_MESSAGE, null)
      return
    }
    val cb = HotspotCallback(promise)
    hotspotCallback = cb
    // Some devices drop the request with no callback: give up after a time.
    main.postDelayed({
      if (hotspotCallback === cb && hotspotReservation == null) {
        val message = if (airplaneModeOn()) AIRPLANE_MESSAGE else "The hotspot did not start. Try again, or turn Wi-Fi off and on."
        if (cb.giveUp(message)) hotspotCallback = null
      }
    }, HOTSPOT_TIMEOUT_MS)
    try {
      wm.startLocalOnlyHotspot(cb, main)
    } catch (e: IllegalStateException) {
      hotspotCallback = null
      promise.reject("ERR_HOTSPOT", "A hotspot request is open already.", e)
    } catch (e: SecurityException) {
      hotspotCallback = null
      promise.reject("ERR_HOTSPOT_PERMISSION", "Android did not allow the hotspot: ${e.message}", e)
    }
  }

  /** Main thread. */
  private fun stopHotspotNow() {
    val r = hotspotReservation
    hotspotReservation = null
    hotspotCallback = null
    if (r != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        (r as WifiManager.LocalOnlyHotspotReservation).close()
      } catch (e: Exception) {
        Log.w(TAG, "Could not close the hotspot", e)
      }
      emit("onHotspot", mapOf("state" to "stopped"))
    }
  }

  @Suppress("DEPRECATION")
  @TargetApi(Build.VERSION_CODES.O)
  private fun credentials(r: WifiManager.LocalOnlyHotspotReservation): Pair<String, String> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val c = r.softApConfiguration
      return Pair(c.ssid ?: "", c.passphrase ?: "")
    }
    val w = r.wifiConfiguration
    return Pair(unquote(w?.SSID), unquote(w?.preSharedKey))
  }

  private fun unquote(s: String?): String {
    if (s == null) return ""
    return if (s.length >= 2 && s.startsWith("\"") && s.endsWith("\"")) s.substring(1, s.length - 1) else s
  }

  private fun airplaneModeOn(): Boolean {
    val ctx = context() ?: return false
    return try {
      Settings.Global.getInt(ctx.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0
    } catch (e: Exception) {
      false
    }
  }

  @TargetApi(Build.VERSION_CODES.O)
  private inner class HotspotCallback(private val promise: Promise) : WifiManager.LocalOnlyHotspotCallback() {
    private val done = AtomicBoolean(false)

    /** No answer from Android in time. False when the answer came already. */
    fun giveUp(message: String): Boolean {
      if (!done.compareAndSet(false, true)) return false
      promise.reject("ERR_HOTSPOT", message, null)
      emit("onHotspot", mapOf("state" to "failed", "message" to message))
      return true
    }

    override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation?) {
      if (hotspotCallback !== this || reservation == null) {
        reservation?.close()
        if (done.compareAndSet(false, true)) promise.reject("ERR_HOTSPOT", "The hotspot request was canceled.", null)
        return
      }
      hotspotReservation = reservation
      val (ssid, password) = credentials(reservation)
      if (done.compareAndSet(false, true)) promise.resolve(mapOf("ssid" to ssid, "password" to password))
      emit("onHotspot", mapOf("state" to "started", "ssid" to ssid, "password" to password))
    }

    override fun onStopped() {
      if (hotspotCallback !== this) return
      hotspotCallback = null
      hotspotReservation = null
      if (done.compareAndSet(false, true)) promise.reject("ERR_HOTSPOT", "The hotspot stopped.", null)
      emit("onHotspot", mapOf("state" to "stopped"))
    }

    override fun onFailed(reason: Int) {
      if (hotspotCallback !== this) return
      hotspotCallback = null
      hotspotReservation = null
      val message = when (reason) {
        WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL -> "No Wi-Fi channel is free for a hotspot."
        WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE -> "The hotspot cannot start while tethering or an other Wi-Fi mode is on."
        WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED -> "A device policy does not allow a hotspot."
        else -> "The hotspot did not start (error $reason)."
      }
      if (done.compareAndSet(false, true)) promise.reject("ERR_HOTSPOT", message, null)
      emit("onHotspot", mapOf("state" to "failed", "message" to message))
    }
  }

  companion object {
    private const val TAG = "ZoggyfinTogether"
    private const val HOTSPOT_TIMEOUT_MS = 15_000L
    private const val AIRPLANE_MESSAGE =
      "Android cannot make a hotspot in airplane mode on this phone. Turn off airplane mode for the session, or let the other device make the Wi-Fi."
  }
}
