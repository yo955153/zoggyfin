/**
 * The nearby transport contract. Each platform implements it once:
 *
 * - iOS / iPadOS: `modules/zoggyfin-native/ios/NearbyCore.swift` (Network.framework),
 *   wrapped by `ZoggyfinTogetherModule.swift`.
 * - macOS desktop app: the same `NearbyCore.swift`, linked into the Tauri app
 *   (`desktop/src-tauri/swift/`, `desktop/src-tauri/src/nearby.rs`).
 * - Android: `modules/zoggyfin-native/android/.../ZoggyfinTogetherModule.kt`
 *   (NsdManager, sockets, a small HTTP range server).
 *
 * The session logic (handshake, protocol, clock, drift) is shared JavaScript
 * in `link.ts` and `nearby.ts`. The native part only finds services, carries
 * framed text and serves files.
 *
 * Wire format (all platforms, all directions):
 *
 * - Bonjour / DNS-SD service type `_zgf-together._tcp`. The host gives the
 *   instance name ("zgf-1a2b3c4d") and the TXT record (short keys, see protocol.ts).
 *   Apple platforms set `includePeerToPeer` on the listener, the browser and each
 *   connection, so Apple devices also connect with no router (AWDL).
 * - One TCP port per session for two kinds of connection:
 *   - A control socket starts with the 4 ASCII bytes `ZGF1` from the guest.
 *     After that, each frame in each direction is a 4-byte unsigned big-endian
 *     length N (1 ... 1 048 576) and N bytes of UTF-8 text (one JSON message).
 *     A bad length closes the socket.
 *   - Any other connection is HTTP/1.1 (GET or HEAD, keep-alive, one `Range`
 *     per request: `bytes=a-b`, `bytes=a-`, `bytes=-n`; 200 / 206 / 416).
 *     Only shared paths answer (`/<token>/<name>`); every other path gets 404.
 * - `receivedAt` is the native monotonic clock (ms) when the frame's bytes
 *   arrived. `monotonicNow()` uses the same clock.
 * - Addresses are IPv4 only (the join code and the media URL on Android).
 */

export interface LinkService {
  /** The instance name of the service; unique on the network. */
  serviceId: string;
  name: string;
  txt: Record<string, string>;
}

export type LinkErrorCode = 'local-network-denied' | 'server' | 'browse' | 'hotspot' | 'other';

export interface LinkEvents {
  onServiceFound: (e: LinkService) => void;
  onServiceLost: (e: { serviceId: string }) => void;
  /** A control socket is open. Host: a guest connected (`inbound`). Guest: `connect` succeeded. */
  onSocketOpen: (e: { socketId: string; inbound: boolean }) => void;
  onFrame: (e: { socketId: string; text: string; receivedAt: number }) => void;
  onSocketClosed: (e: { socketId: string; reason: string | null }) => void;
  onError: (e: { message: string; code?: LinkErrorCode }) => void;
  /** Android only: the local-only hotspot changed. */
  onHotspot: (e: { state: 'started' | 'stopped' | 'failed'; ssid?: string; password?: string; message?: string }) => void;
  // Bluetooth LE rendezvous (see the BLE section below).
  onBleState: (e: { state: BleState }) => void;
  /** Central: a host found, and its INFO characteristic read. `info` is the INFO text (JSON). */
  onBlePeer: (e: { peerId: string; info: string; rssi: number }) => void;
  onBlePeerLost: (e: { peerId: string }) => void;
  /** Peripheral: a central subscribed to TX. Central: the link to the peer is ready for `bleSend`. */
  onBleConnected: (e: { peerId: string; role: 'central' | 'peripheral' }) => void;
  /** One whole message (the chunks are joined). */
  onBleMessage: (e: { peerId: string; text: string }) => void;
  onBleDisconnected: (e: { peerId: string }) => void;
  /** `joinWifi` finished in the background (Android: the network became available or was lost). */
  onWifi: (e: { state: 'joined' | 'lost' | 'failed'; ssid: string; message?: string }) => void;
}

/**
 * Bluetooth LE rendezvous. It finds a session with no shared Wi-Fi and
 * carries a few small messages, so that an Android device can make a Wi-Fi
 * network (local-only hotspot) and the other device can join it. The
 * session itself always runs over TCP (above), never over Bluetooth.
 *
 * - GATT service `FBB4EFE8-5E2A-49CF-A621-716EEDA1CB11`. The host is the
 *   peripheral; it advertises the service UUID (Android: plus a scan response
 *   with the local name; Apple: the local name).
 * - Characteristic INFO `FBB4EFE9-5E2A-49CF-A621-716EEDA1CB11`: read. UTF-8
 *   JSON, at most 200 bytes (long reads with offsets must work).
 * - Characteristic RX `FBB4EFEA-5E2A-49CF-A621-716EEDA1CB11`: write with
 *   response, central to peripheral.
 * - Characteristic TX `FBB4EFEB-5E2A-49CF-A621-716EEDA1CB11`: notify,
 *   peripheral to central.
 * - A message (UTF-8 text, at most 4096 bytes) goes in chunks. Each chunk is
 *   one header byte and up to (ATT MTU - 3 - 1) bytes. Header: bit 7 = 1 on
 *   the last chunk of a message; bits 0-6 = chunk number mod 128 (starts at 0
 *   for each message). The receiver joins the chunks in order and drops a
 *   message with a missing chunk. Android asks for MTU 517; Apple uses
 *   `maximumWriteValueLength` / `maximumUpdateValueLength`.
 * - The central connects to each peer it finds, reads INFO, subscribes to TX
 *   and keeps the link while it scans (at most 8 peers). `onBleConnected`
 *   comes after the TX subscription is active on both sides.
 */
export const BLE_SERVICE = 'FBB4EFE8-5E2A-49CF-A621-716EEDA1CB11';
export const BLE_INFO = 'FBB4EFE9-5E2A-49CF-A621-716EEDA1CB11';
export const BLE_RX = 'FBB4EFEA-5E2A-49CF-A621-716EEDA1CB11';
export const BLE_TX = 'FBB4EFEB-5E2A-49CF-A621-716EEDA1CB11';

export type BleState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';

export interface LinkAddress {
  /** The interface name ("en0", "wlan0", "ap0", "bridge100"). */
  name: string;
  /** IPv4, dotted. */
  address: string;
  /** `hotspot`: this device makes the Wi-Fi network (Android local-only hotspot, iPhone Personal Hotspot, Mac Internet Sharing). */
  kind: 'wifi' | 'hotspot' | 'ethernet' | 'other';
}

export interface MediaStats {
  served: number;
  requests: number;
  relayed: number;
}

export interface NearbyLinkNative {
  readonly platform: 'apple' | 'android';
  monotonicNow(): number;
  /** `n` (1 ... 1024) bytes from the platform's secure random source, base64. Synchronous. */
  randomBytes(n: number): string;

  // Host
  /** Opens the session port and advertises it. Resolves with the port and the instance name. */
  startServer(serviceName: string, txt: Record<string, string>): Promise<{ port: number; service: string }>;
  /**
   * Opens the session port with no advert at all ("Only with my code"):
   * guests join with the code. Optional: an older build has only
   * `startServer`, and the caller stops its advert at once.
   */
  startServerUnlisted?(serviceName: string): Promise<{ port: number; service: string }>;
  /** Stops the advert; the port and the open sockets stay. */
  stopAdvertising(): void;
  /**
   * Changes the TXT record of the advert (the room's item changed). No effect
   * when the session does not advertise (unlisted, or after `stopAdvertising`).
   * Apple: the listener's service changes in place. Android: NSD cannot change
   * a TXT record, so the service registers again, once for each burst of
   * changes (a debounce of about 1 s), with the same name and port. Browsers
   * report the new record as `onServiceFound` for the same service id (on
   * Android a guest resolves each found service again every few seconds).
   * Optional: an older build keeps its first advert.
   */
  updateAdvert?(txt: Record<string, string>): void;
  /** Adds a file at a URL path ("/<token>/track-3.m4a"). The path is the secret. */
  shareFile(urlPath: string, filePath: string, mimeType: string): void;
  /**
   * Paces each response of a shared file: the first 10 s of media (at
   * `bytesPerSecond`, the file's bitrate) go at once, then at most 1.5 x the
   * bitrate. One new guest or one seek then does not take the upload from
   * the others. Optional: an older build sends at link speed.
   */
  setPace?(urlPath: string, bytesPerSecond: number): void;
  unshareAll(): void;
  /** Closes the port, every socket and the advert. */
  stopServer(): void;

  // Guest
  startBrowsing(): void;
  stopBrowsing(): void;
  /** Opens a control socket to a found service. Returns the socket id; `onSocketOpen` or `onSocketClosed` follows. */
  connect(serviceId: string): string;
  /** Opens a control socket to an address (join code). */
  connectAddress(host: string, port: number): string;
  /**
   * The URL base where this device's players read the host's files, for
   * example "http://127.0.0.1:50123" (Apple: a loopback relay to the host,
   * because a player cannot open a Bonjour name) or "http://172.20.1.4:50999"
   * (Android: the resolved address). Give a service id, or a host and a port.
   */
  mediaBase(serviceId: string | null, host: string | null, port: number): Promise<string>;
  stopRelay(): void;

  // Both
  send(socketId: string, text: string): boolean;
  /**
   * Sends one text to several sockets in one call (a broadcast: the group
   * state, a members delta). Optional: without it, `send` goes once per socket.
   */
  sendMany?(socketIds: string[], text: string): void;
  /**
   * Host: sends a pong to a ping. The native layer builds the message and
   * stamps `t2` (its monotonic clock) right before the frame goes to the
   * socket, so a wait in a queue (the JavaScript thread, the Mac app's Tauri
   * bridge) does not make the guest's clock wrong. Optional: older builds
   * have none, and JavaScript stamps `t2`.
   */
  sendPong?(socketId: string, id: number, t0: number, t1: number): boolean;
  close(socketId: string): void;
  /** The IPv4 addresses of this device, for the join code. */
  addresses(): Promise<LinkAddress[]>;
  /** Closes everything: server, sockets, browser, relay (not the hotspot). */
  stopAll(): void;
  mediaStats(): MediaStats;

  /** Android 8+: a Wi-Fi network for this session (WifiManager.startLocalOnlyHotspot). */
  startHotspot?(): Promise<{ ssid: string; password: string }>;
  stopHotspot?(): void;

  // Bluetooth LE (optional: a build without it leaves these out)
  bleState?(): Promise<BleState>;
  /** Asks for the Bluetooth permissions (Android 12+: SCAN, ADVERTISE, CONNECT; Android 9-11: location; Apple: the system prompt). */
  bleRequestPermission?(): Promise<BleState>;
  /** Host: be a peripheral with this INFO text and advertise. Calling it again changes INFO. */
  bleAdvertise?(info: string, localName: string): void;
  bleStopAdvertising?(): void;
  bleScan?(): void;
  bleStopScan?(): void;
  bleSend?(peerId: string, text: string): boolean;
  bleDisconnect?(peerId: string): void;
  /** Stops advertising and scanning and closes every BLE link. */
  bleStopAll?(): void;

  // Wi-Fi join (for the rendezvous)
  /**
   * Joins a Wi-Fi network. iOS: NEHotspotConfiguration (joinOnce). macOS:
   * CoreWLAN. Android 10+: WifiNetworkSpecifier (the system asks the user),
   * and the app's sockets use that network; Android 9: WifiManager.addNetwork.
   * Resolves when the device is on the network.
   */
  joinWifi?(ssid: string, password: string): Promise<void>;
  leaveWifi?(ssid: string): void;
  /** Opens the system settings page of this app (a denied permission). */
  openSettings?(): void;

  on<K extends keyof LinkEvents>(name: K, listener: LinkEvents[K]): { remove(): void };
}
