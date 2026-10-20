// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Bluetooth LE rendezvous (see the BLE section of link-native-types.ts).
 *
 * - Peripheral (host): an advert with the service UUID and a GATT server
 *   with INFO (read), RX (write with response) and TX (notify).
 * - Central (guest): a scan with a filter on the service UUID. For each
 *   peer: connect, MTU 517, discover, read INFO, subscribe to TX.
 *
 * All state changes on one handler thread ("zgf-ble"). The Bluetooth
 * callbacks come on binder threads; they copy the values and post to that
 * thread. Android GATT does one operation at a time for each device, so each
 * link sends one chunk and waits for its callback before the next chunk.
 */
@SuppressLint("MissingPermission")
internal class NearbyBle(
  private val contextProvider: () -> Context?,
  private val emit: (String, Map<String, Any?>) -> Unit
) {
  companion object {
    private const val TAG = "ZoggyfinBle"
    val SERVICE: UUID = UUID.fromString("FBB4EFE8-5E2A-49CF-A621-716EEDA1CB11")
    val INFO: UUID = UUID.fromString("FBB4EFE9-5E2A-49CF-A621-716EEDA1CB11")
    val RX: UUID = UUID.fromString("FBB4EFEA-5E2A-49CF-A621-716EEDA1CB11")
    val TX: UUID = UUID.fromString("FBB4EFEB-5E2A-49CF-A621-716EEDA1CB11")
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val MAX_MESSAGE = 4096
    const val MAX_PEERS = 8
    const val DEFAULT_MTU = 23
    const val WANTED_MTU = 517
    const val SETUP_TIMEOUT_MS = 20_000L
    const val OP_TIMEOUT_MS = 5_000L
    const val RETRY_COOLDOWN_MS = 10_000L
  }

  private val thread = HandlerThread("zgf-ble").apply { start() }
  private val handler = Handler(thread.looper)

  /** Peers that can take `send` now. Read from the JavaScript thread. */
  private val centralReady: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())
  private val peripheralReady: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())

  private var receiverOn = false

  // Peripheral state
  private var gattServer: BluetoothGattServer? = null
  private var txCharacteristic: BluetoothGattCharacteristic? = null
  private var serviceReady = false
  private var wantAdvertising = false
  private var advertiseCallback: AdvertiseCallback? = null
  private var infoBytes = ByteArray(0)
  private val subscribers = HashMap<String, Subscriber>()

  // Central state
  private var scanCallback: ScanCallback? = null
  private val links = HashMap<String, Link>()
  private val cooldown = HashMap<String, Long>()

  /** Joins the chunks of one message. */
  private class Reassembler {
    private val buf = ByteArrayOutputStream()
    private var next = 0
    private var broken = false

    /** A whole message, or null. */
    fun add(chunk: ByteArray?): String? {
      if (chunk == null || chunk.isEmpty()) return null
      val header = chunk[0].toInt() and 0xff
      val index = header and 0x7f
      val last = (header and 0x80) != 0
      if (index != next) {
        if (index == 0) {
          // A new message starts; the old one has a missing chunk.
          buf.reset()
          broken = false
        } else {
          broken = true
        }
      }
      if (!broken) {
        buf.write(chunk, 1, chunk.size - 1)
        if (buf.size() > MAX_MESSAGE) broken = true
      }
      next = (index + 1) % 128
      if (!last) return null
      val text = if (broken) null else String(buf.toByteArray(), Charsets.UTF_8)
      buf.reset()
      broken = false
      next = 0
      return text
    }
  }

  /** A central that connected to our GATT server. */
  private class Subscriber(val device: BluetoothDevice) {
    var mtu = DEFAULT_MTU
    var subscribed = false
    val rx = Reassembler()
    val out = ArrayDeque<ByteArray>()
    var sending = false
    var sendSeq = 0
    var retries = 0
  }

  private enum class Stage { CONNECTING, MTU, DISCOVER, READ, SUBSCRIBE, READY }

  /** A peripheral that we (the central) connected to. */
  private class Link(val device: BluetoothDevice) {
    var gatt: BluetoothGatt? = null
    var stage = Stage.CONNECTING
    var mtu = DEFAULT_MTU
    var rssi = 0
    var info: String? = null
    var announced = false
    val rx = Reassembler()
    val early = ArrayList<String>()
    val out = ArrayDeque<ByteArray>()
    var writing = false
    var writeSeq = 0
    var retries = 0
  }

  // MARK: State and permissions

  private fun context(): Context? = contextProvider()

  private fun manager(): BluetoothManager? = context()?.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?

  private fun adapter(): BluetoothAdapter? = manager()?.adapter

  fun requiredPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_ADVERTISE,
        Manifest.permission.BLUETOOTH_CONNECT
      )
    } else {
      arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  private fun granted(ctx: Context): Boolean =
    requiredPermissions().all { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

  /** "on", "off", "unauthorized", "unsupported" or "unknown". Any thread. */
  fun state(): String {
    val ctx = context() ?: return "unknown"
    if (!ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) return "unsupported"
    val a = adapter() ?: return "unsupported"
    if (!granted(ctx)) return "unauthorized"
    return try {
      if (a.isEnabled) "on" else "off"
    } catch (e: SecurityException) {
      "unauthorized"
    }
  }

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context?, intent: Intent?) {
      if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
      when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
        BluetoothAdapter.STATE_ON -> emit("onBleState", mapOf("state" to state()))
        BluetoothAdapter.STATE_OFF -> {
          handler.post { dropAll() }
          emit("onBleState", mapOf("state" to "off"))
        }
      }
    }
  }

  /** Listens for Bluetooth on and off. It asks for no permission. */
  fun attach() {
    handler.post {
      if (receiverOn) return@post
      val ctx = context() ?: return@post
      try {
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= 33) {
          ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          ctx.registerReceiver(receiver, filter)
        }
        receiverOn = true
      } catch (e: Exception) {
        Log.w(TAG, "No Bluetooth state receiver", e)
      }
    }
  }

  fun dispose() {
    handler.post {
      dropAll()
      if (receiverOn) {
        try {
          context()?.unregisterReceiver(receiver)
        } catch (e: IllegalArgumentException) {
          // The receiver is not registered.
        }
        receiverOn = false
      }
    }
    thread.quitSafely()
  }

  private fun fail(message: String) {
    emit("onError", mapOf("message" to message, "code" to "other"))
  }

  // MARK: Peripheral (host)

  fun advertise(info: String, localName: String) {
    attach()
    handler.post {
      infoBytes = info.toByteArray(Charsets.UTF_8)
      wantAdvertising = true
      if (gattServer == null) {
        openServer()
      } else if (serviceReady && advertiseCallback == null) {
        startAdvertising(withName = true)
      }
    }
  }

  fun stopAdvertising() {
    handler.post {
      wantAdvertising = false
      stopAdvertisingNow()
    }
  }

  private fun openServer() {
    val ctx = context() ?: return
    val m = manager()
    if (m == null || m.adapter == null) {
      fail("This device has no Bluetooth.")
      return
    }
    val server = try {
      m.openGattServer(ctx, serverCallback)
    } catch (e: SecurityException) {
      fail("Zoggyfin has no Bluetooth permission.")
      return
    }
    if (server == null) {
      fail("Could not open the Bluetooth GATT server.")
      return
    }
    val service = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val info = BluetoothGattCharacteristic(
      INFO,
      BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ
    )
    val rx = BluetoothGattCharacteristic(
      RX,
      BluetoothGattCharacteristic.PROPERTY_WRITE,
      BluetoothGattCharacteristic.PERMISSION_WRITE
    )
    val tx = BluetoothGattCharacteristic(
      TX,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ
    )
    tx.addDescriptor(
      BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE)
    )
    service.addCharacteristic(info)
    service.addCharacteristic(rx)
    service.addCharacteristic(tx)
    gattServer = server
    txCharacteristic = tx
    serviceReady = false
    // The advert starts in onServiceAdded.
    if (!server.addService(service)) {
      fail("Could not add the Bluetooth service.")
      closeServer()
    }
  }

  private fun startAdvertising(withName: Boolean) {
    if (!wantAdvertising || advertiseCallback != null) return
    val advertiser = try {
      adapter()?.bluetoothLeAdvertiser
    } catch (e: SecurityException) {
      null
    }
    if (advertiser == null) {
      fail("This device cannot advertise over Bluetooth LE.")
      return
    }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(SERVICE))
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .build()
    // Android can only send the device name (the adapter name) as the local name.
    val scanResponse = AdvertiseData.Builder()
      .setIncludeDeviceName(withName)
      .setIncludeTxPowerLevel(false)
      .build()
    val cb = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {}

      override fun onStartFailure(errorCode: Int) {
        handler.post {
          if (advertiseCallback !== this) return@post
          advertiseCallback = null
          when {
            errorCode == ADVERTISE_FAILED_DATA_TOO_LARGE && withName -> startAdvertising(withName = false)
            errorCode == ADVERTISE_FAILED_ALREADY_STARTED -> {}
            else -> fail("Could not advertise over Bluetooth LE (error $errorCode).")
          }
        }
      }
    }
    advertiseCallback = cb
    try {
      advertiser.startAdvertising(settings, data, scanResponse, cb)
    } catch (e: SecurityException) {
      advertiseCallback = null
      fail("Zoggyfin has no Bluetooth advertise permission.")
    }
  }

  private fun stopAdvertisingNow() {
    val cb = advertiseCallback ?: return
    advertiseCallback = null
    try {
      adapter()?.bluetoothLeAdvertiser?.stopAdvertising(cb)
    } catch (e: Exception) {
      // Bluetooth is off or the permission is gone.
    }
  }

  private fun closeServer() {
    stopAdvertisingNow()
    val server = gattServer
    gattServer = null
    txCharacteristic = null
    serviceReady = false
    for (s in subscribers.values.toList()) {
      try {
        server?.cancelConnection(s.device)
      } catch (e: Exception) {
      }
      removeSubscriber(s)
    }
    subscribers.clear()
    try {
      server?.close()
    } catch (e: Exception) {
    }
  }

  private fun subscriber(device: BluetoothDevice): Subscriber =
    subscribers.getOrPut(device.address) { Subscriber(device) }

  private fun removeSubscriber(s: Subscriber) {
    val id = s.device.address
    subscribers.remove(id)
    s.out.clear()
    if (s.subscribed) {
      s.subscribed = false
      peripheralReady.remove(id)
      emit("onBleDisconnected", mapOf("peerId" to id))
    }
  }

  @Suppress("DEPRECATION")
  private fun pumpNotify(s: Subscriber) {
    if (s.sending || !s.subscribed) return
    val chunk = s.out.firstOrNull() ?: return
    val server = gattServer ?: return
    val tx = txCharacteristic ?: return
    val ok = try {
      if (Build.VERSION.SDK_INT >= 33) {
        server.notifyCharacteristicChanged(s.device, tx, false, chunk) == BluetoothStatusCodes.SUCCESS
      } else {
        tx.value = chunk
        server.notifyCharacteristicChanged(s.device, tx, false)
      }
    } catch (e: Exception) {
      false
    }
    if (ok) {
      s.out.removeFirst()
      s.retries = 0
      s.sending = true
      val seq = ++s.sendSeq
      handler.postDelayed({
        // No onNotificationSent came: go on with the next chunk.
        if (s.sending && s.sendSeq == seq) {
          s.sending = false
          pumpNotify(s)
        }
      }, OP_TIMEOUT_MS)
    } else if (s.retries < 5) {
      s.retries++
      handler.postDelayed({ pumpNotify(s) }, 50)
    } else {
      // The stack does not take the chunk: drop this message.
      s.retries = 0
      s.out.clear()
    }
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
      handler.post {
        if (service?.uuid != SERVICE) return@post
        if (status == BluetoothGatt.GATT_SUCCESS) {
          serviceReady = true
          startAdvertising(withName = true)
        } else {
          fail("Could not add the Bluetooth service (error $status).")
        }
      }
    }

    override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
      device ?: return
      handler.post {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          if (gattServer != null) subscriber(device)
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          subscribers[device.address]?.let { removeSubscriber(it) }
        }
      }
    }

    override fun onMtuChanged(device: BluetoothDevice?, mtu: Int) {
      device ?: return
      handler.post { subscribers[device.address]?.mtu = mtu }
    }

    override fun onCharacteristicReadRequest(
      device: BluetoothDevice?,
      requestId: Int,
      offset: Int,
      characteristic: BluetoothGattCharacteristic?
    ) {
      device ?: return
      handler.post {
        val server = gattServer ?: return@post
        try {
          if (characteristic?.uuid == INFO) {
            val value = infoBytes
            if (offset < 0 || offset > value.size) {
              server.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
            } else {
              // A read answer holds at most MTU - 1 bytes. The central reads the rest with offsets.
              val mtu = subscribers[device.address]?.mtu ?: DEFAULT_MTU
              val end = minOf(value.size, offset + mtu - 1)
              server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value.copyOfRange(offset, end))
            }
          } else {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null)
          }
        } catch (e: Exception) {
          Log.w(TAG, "Read answer failed", e)
        }
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice?,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic?,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      device ?: return
      val bytes = value?.copyOf()
      val uuid = characteristic?.uuid
      handler.post {
        val server = gattServer ?: return@post
        val status = when {
          uuid != RX -> BluetoothGatt.GATT_WRITE_NOT_PERMITTED
          preparedWrite -> BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED
          else -> BluetoothGatt.GATT_SUCCESS
        }
        if (responseNeeded) {
          try {
            server.sendResponse(device, requestId, status, offset, bytes)
          } catch (e: Exception) {
            Log.w(TAG, "Write answer failed", e)
          }
        }
        if (status != BluetoothGatt.GATT_SUCCESS) return@post
        val s = subscriber(device)
        s.rx.add(bytes)?.let { text ->
          emit("onBleMessage", mapOf("peerId" to device.address, "text" to text))
        }
      }
    }

    override fun onDescriptorReadRequest(
      device: BluetoothDevice?,
      requestId: Int,
      offset: Int,
      descriptor: BluetoothGattDescriptor?
    ) {
      device ?: return
      handler.post {
        val server = gattServer ?: return@post
        try {
          if (descriptor?.uuid == CCCD) {
            val on = subscribers[device.address]?.subscribed == true
            val v = if (on) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, v)
          } else {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null)
          }
        } catch (e: Exception) {
          Log.w(TAG, "Descriptor read answer failed", e)
        }
      }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice?,
      requestId: Int,
      descriptor: BluetoothGattDescriptor?,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      device ?: return
      val bytes = value?.copyOf()
      val isTxCccd = descriptor != null && descriptor.uuid == CCCD && descriptor.characteristic?.uuid == TX
      handler.post {
        val server = gattServer ?: return@post
        val status = if (isTxCccd) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_WRITE_NOT_PERMITTED
        if (responseNeeded) {
          try {
            server.sendResponse(device, requestId, status, offset, bytes)
          } catch (e: Exception) {
            Log.w(TAG, "Descriptor write answer failed", e)
          }
        }
        if (!isTxCccd) return@post
        val enable = bytes != null && bytes.isNotEmpty() && (bytes[0].toInt() and 0x01) != 0
        val s = subscriber(device)
        val id = device.address
        if (enable && !s.subscribed) {
          s.subscribed = true
          peripheralReady.add(id)
          emit("onBleConnected", mapOf("peerId" to id, "role" to "peripheral"))
        } else if (!enable && s.subscribed) {
          s.subscribed = false
          s.out.clear()
          peripheralReady.remove(id)
          emit("onBleDisconnected", mapOf("peerId" to id))
        }
      }
    }

    override fun onNotificationSent(device: BluetoothDevice?, status: Int) {
      device ?: return
      handler.post {
        val s = subscribers[device.address] ?: return@post
        s.sending = false
        pumpNotify(s)
      }
    }
  }

  // MARK: Central (guest)

  fun scan() {
    attach()
    handler.post {
      if (scanCallback != null) return@post
      val scanner = try {
        adapter()?.bluetoothLeScanner
      } catch (e: SecurityException) {
        null
      }
      if (scanner == null) {
        fail("Bluetooth is off or not available.")
        return@post
      }
      val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build())
      val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
      val cb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
          result ?: return
          handler.post { if (scanCallback === this) found(result) }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
          val list = results?.toList() ?: return
          handler.post { if (scanCallback === this) list.forEach { found(it) } }
        }

        override fun onScanFailed(errorCode: Int) {
          handler.post {
            if (scanCallback !== this) return@post
            scanCallback = null
            fail("The Bluetooth scan failed (error $errorCode).")
          }
        }
      }
      scanCallback = cb
      try {
        scanner.startScan(filters, settings, cb)
      } catch (e: SecurityException) {
        scanCallback = null
        fail("Zoggyfin has no Bluetooth scan permission.")
      }
    }
  }

  fun stopScan() {
    handler.post { stopScanNow() }
  }

  private fun stopScanNow() {
    val cb = scanCallback ?: return
    scanCallback = null
    try {
      adapter()?.bluetoothLeScanner?.stopScan(cb)
    } catch (e: Exception) {
      // Bluetooth is off or the permission is gone.
    }
  }

  private fun found(result: ScanResult) {
    val device = result.device ?: return
    val id = device.address
    links[id]?.let {
      it.rssi = result.rssi
      return
    }
    if (links.size >= MAX_PEERS) return
    val until = cooldown[id]
    if (until != null && System.currentTimeMillis() < until) return
    val ctx = context() ?: return
    val link = Link(device)
    link.rssi = result.rssi
    links[id] = link
    val gatt = try {
      device.connectGatt(ctx, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    } catch (e: SecurityException) {
      null
    }
    if (gatt == null) {
      links.remove(id)
      cooldown[id] = System.currentTimeMillis() + RETRY_COOLDOWN_MS
      return
    }
    link.gatt = gatt
    handler.postDelayed({
      if (links[id] === link && link.stage != Stage.READY) drop(link, cool = true)
    }, SETUP_TIMEOUT_MS)
  }

  private fun linkFor(gatt: BluetoothGatt): Link? {
    val l = links[gatt.device?.address ?: return null] ?: return null
    return if (l.gatt === gatt) l else null
  }

  /** Closes a link. Sends onBleDisconnected and onBlePeerLost when JavaScript knows the peer. */
  private fun drop(link: Link, cool: Boolean = false) {
    val id = link.device.address
    if (links[id] === link) links.remove(id)
    if (cool) cooldown[id] = System.currentTimeMillis() + RETRY_COOLDOWN_MS
    try {
      link.gatt?.disconnect()
      link.gatt?.close()
    } catch (e: Exception) {
    }
    link.gatt = null
    link.out.clear()
    if (link.stage == Stage.READY) {
      link.stage = Stage.CONNECTING
      centralReady.remove(id)
      emit("onBleDisconnected", mapOf("peerId" to id))
    }
    if (link.announced) {
      link.announced = false
      emit("onBlePeerLost", mapOf("peerId" to id))
    }
  }

  private fun discover(link: Link, gatt: BluetoothGatt) {
    if (link.stage != Stage.MTU) return
    link.stage = Stage.DISCOVER
    val ok = try {
      gatt.discoverServices()
    } catch (e: SecurityException) {
      false
    }
    if (!ok) drop(link, cool = true)
  }

  @Suppress("DEPRECATION")
  private fun infoRead(link: Link, gatt: BluetoothGatt, value: ByteArray?, status: Int) {
    if (link.stage != Stage.READ) return
    if (status != BluetoothGatt.GATT_SUCCESS || value == null) {
      drop(link, cool = true)
      return
    }
    link.info = String(value, Charsets.UTF_8)
    link.stage = Stage.SUBSCRIBE
    val tx = gatt.getService(SERVICE)?.getCharacteristic(TX)
    val cccd = tx?.getDescriptor(CCCD)
    if (tx == null || cccd == null) {
      drop(link, cool = true)
      return
    }
    val ok = try {
      gatt.setCharacteristicNotification(tx, true)
      if (Build.VERSION.SDK_INT >= 33) {
        gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS
      } else {
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        gatt.writeDescriptor(cccd)
      }
    } catch (e: SecurityException) {
      false
    }
    if (!ok) drop(link, cool = true)
  }

  private fun notified(link: Link, value: ByteArray?) {
    val text = link.rx.add(value) ?: return
    if (link.stage == Stage.READY) {
      emit("onBleMessage", mapOf("peerId" to link.device.address, "text" to text))
    } else {
      // The host can notify before our onDescriptorWrite. Keep the message until JavaScript knows the peer.
      link.early.add(text)
    }
  }

  @Suppress("DEPRECATION")
  private fun pumpWrite(link: Link) {
    if (link.writing || link.stage != Stage.READY) return
    val chunk = link.out.firstOrNull() ?: return
    val gatt = link.gatt ?: return
    val rx = gatt.getService(SERVICE)?.getCharacteristic(RX) ?: return
    val ok = try {
      if (Build.VERSION.SDK_INT >= 33) {
        gatt.writeCharacteristic(rx, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
      } else {
        rx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        rx.value = chunk
        gatt.writeCharacteristic(rx)
      }
    } catch (e: SecurityException) {
      false
    }
    if (ok) {
      link.out.removeFirst()
      link.retries = 0
      link.writing = true
      val seq = ++link.writeSeq
      handler.postDelayed({
        // No onCharacteristicWrite came: the link is broken.
        if (link.writing && link.writeSeq == seq && links[link.device.address] === link) drop(link)
      }, OP_TIMEOUT_MS * 2)
    } else if (link.retries < 5) {
      link.retries++
      handler.postDelayed({ pumpWrite(link) }, 50)
    } else {
      link.retries = 0
      link.out.clear()
    }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      handler.post {
        val link = linkFor(gatt)
        if (link == null) {
          try {
            gatt.close()
          } catch (e: Exception) {
          }
          return@post
        }
        if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
          if (link.stage != Stage.CONNECTING) return@post
          link.stage = Stage.MTU
          val asked = try {
            gatt.requestMtu(WANTED_MTU)
          } catch (e: SecurityException) {
            false
          }
          if (!asked) {
            discover(link, gatt)
          } else {
            // Some devices do not answer the MTU request.
            handler.postDelayed({ if (links[link.device.address] === link) discover(link, gatt) }, 3_000)
          }
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
          drop(link, cool = link.stage != Stage.READY)
        }
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      handler.post {
        val link = linkFor(gatt) ?: return@post
        if (status == BluetoothGatt.GATT_SUCCESS) link.mtu = mtu
        discover(link, gatt)
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      handler.post {
        val link = linkFor(gatt) ?: return@post
        if (link.stage != Stage.DISCOVER) return@post
        val info = gatt.getService(SERVICE)?.getCharacteristic(INFO)
        if (status != BluetoothGatt.GATT_SUCCESS || info == null) {
          drop(link, cool = true)
          return@post
        }
        link.stage = Stage.READ
        // Android reads a long value with offsets (read blob) by itself.
        val ok = try {
          gatt.readCharacteristic(info)
        } catch (e: SecurityException) {
          false
        }
        if (!ok) drop(link, cool = true)
      }
    }

    // Android 13 and later call this form; its default calls the old form.
    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
      if (characteristic.uuid != INFO) return
      val bytes = value.copyOf()
      handler.post { linkFor(gatt)?.let { infoRead(it, gatt, bytes, status) } }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      if (Build.VERSION.SDK_INT >= 33) return
      if (characteristic.uuid != INFO) return
      val bytes = characteristic.value?.copyOf()
      handler.post { linkFor(gatt)?.let { infoRead(it, gatt, bytes, status) } }
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      handler.post {
        val link = linkFor(gatt) ?: return@post
        if (descriptor.uuid != CCCD || link.stage != Stage.SUBSCRIBE) return@post
        if (status != BluetoothGatt.GATT_SUCCESS) {
          drop(link, cool = true)
          return@post
        }
        val id = link.device.address
        link.stage = Stage.READY
        link.announced = true
        centralReady.add(id)
        emit("onBlePeer", mapOf("peerId" to id, "info" to (link.info ?: ""), "rssi" to link.rssi))
        emit("onBleConnected", mapOf("peerId" to id, "role" to "central"))
        for (text in link.early) emit("onBleMessage", mapOf("peerId" to id, "text" to text))
        link.early.clear()
        pumpWrite(link)
      }
    }

    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid != TX) return
      val bytes = value.copyOf()
      handler.post { linkFor(gatt)?.let { notified(it, bytes) } }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return
      if (characteristic.uuid != TX) return
      val bytes = characteristic.value?.copyOf()
      handler.post { linkFor(gatt)?.let { notified(it, bytes) } }
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      handler.post {
        val link = linkFor(gatt) ?: return@post
        link.writing = false
        if (status != BluetoothGatt.GATT_SUCCESS) {
          // A chunk did not arrive: the receiver drops this message. Drop the rest of it here too.
          dropRestOfMessage(link.out)
        }
        pumpWrite(link)
      }
    }
  }

  /** Removes the chunks up to and including the next last chunk. */
  private fun dropRestOfMessage(out: ArrayDeque<ByteArray>) {
    while (out.isNotEmpty()) {
      val c = out.removeFirst()
      if (c.isNotEmpty() && (c[0].toInt() and 0x80) != 0) return
    }
  }

  // MARK: Both

  /** Splits a message: one header byte and up to (MTU - 4) bytes in each chunk. */
  private fun chunks(bytes: ByteArray, mtu: Int): List<ByteArray> {
    val size = maxOf(1, mtu - 4)
    val out = ArrayList<ByteArray>()
    var start = 0
    var n = 0
    do {
      val end = minOf(bytes.size, start + size)
      val last = end == bytes.size
      val c = ByteArray(1 + end - start)
      c[0] = ((n % 128) or (if (last) 0x80 else 0)).toByte()
      System.arraycopy(bytes, start, c, 1, end - start)
      out.add(c)
      start = end
      n++
    } while (start < bytes.size)
    return out
  }

  /** Any thread. False when the peer is not ready or the text is too long. */
  fun send(peerId: String, text: String): Boolean {
    val bytes = text.toByteArray(Charsets.UTF_8)
    if (bytes.size > MAX_MESSAGE) return false
    if (peerId !in centralReady && peerId !in peripheralReady) return false
    handler.post {
      val link = links[peerId]
      if (link != null && link.stage == Stage.READY) {
        link.out.addAll(chunks(bytes, link.mtu))
        pumpWrite(link)
        return@post
      }
      val s = subscribers[peerId]
      if (s != null && s.subscribed) {
        s.out.addAll(chunks(bytes, s.mtu))
        pumpNotify(s)
      }
    }
    return true
  }

  fun disconnect(peerId: String) {
    handler.post {
      val link = links[peerId]
      if (link != null) {
        drop(link)
        return@post
      }
      val s = subscribers[peerId] ?: return@post
      try {
        gattServer?.cancelConnection(s.device)
      } catch (e: Exception) {
      }
      removeSubscriber(s)
    }
  }

  fun stopAll() {
    handler.post { dropAll() }
  }

  /** Handler thread. */
  private fun dropAll() {
    wantAdvertising = false
    stopScanNow()
    for (l in links.values.toList()) drop(l)
    links.clear()
    cooldown.clear()
    closeServer()
  }
}
