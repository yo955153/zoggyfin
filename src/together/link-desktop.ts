/**
 * The nearby transport in the macOS desktop app. The Swift code of the iOS
 * module (`modules/zoggyfin-native/ios/NearbyCore.swift` and the others) is
 * linked into the Tauri app (`desktop/src-tauri/swift/`). This module calls it
 * through the Tauri command `nearby_call` (`desktop/src-tauri/src/nearby.rs`)
 * and gets its events through `window.__zoggyfinDesktop.nearby(event)`.
 *
 * Each Tauri call is async. The contract has some sync functions:
 *
 * - `connect` and `connectAddress`: this module makes the socket id and gives
 *   it to Swift. The bridge maps it to the id of NearbyCore.
 * - `send`: true if the socket is open (from the events); the call goes later.
 * - `monotonicNow`: `performance.now()` plus an offset to the native clock,
 *   measured at load and again each 60 s (`desktopLinkReady` resolves after
 *   the first measurement).
 * - `mediaStats`: the last value; each call starts a refresh.
 * - `randomBytes`: `crypto.getRandomValues` in the page.
 *
 * Order and cost: each Tauri call is one IPC round trip, and a broadcast to
 * N guests or a join storm makes many sends. So the short commands (send,
 * sendMany, sendPong, close, connect, the BLE sends ...) are fire and
 * forget: they go to an outbox, and the outbox goes to Swift as one batch
 * (`nearby_post`) per JavaScript tick. A batch starts after the batch
 * before it, so the order stays. A long command (`startServer`,
 * `mediaBase`, the BLE state, `joinWifi`, `addresses`) goes after the
 * batches before it and waits for its own answer; the batches after it do
 * not wait for it.
 */
import { invoke, isDesktop, type NearbyEvent, onNearbyEvent } from '@/platform/desktop';

import type { BleState, LinkAddress, LinkEvents, MediaStats, NearbyLinkNative } from './link-native-types';

function call<T>(cmd: string, args: unknown[] = []): Promise<T> {
  return invoke<T>('nearby_call', { cmd, args });
}

/** The end of the chain of batches. */
let tail: Promise<unknown> = Promise.resolve();
/** The short commands of this tick, in order. */
let outbox: { cmd: string; args: unknown[] }[] = [];
let flushQueued = false;

/** Sends the outbox as one batch, after the batches before it. */
function flush(): void {
  flushQueued = false;
  if (!outbox.length) return;
  const calls = outbox;
  outbox = [];
  tail = tail
    .then(() => invoke('nearby_post', { calls }))
    .catch((e: unknown) => console.warn(`[nearby] a batch of ${calls.length} commands failed:`, e));
}

/** A short command: fire and forget, in order with the other commands. */
function post(cmd: string, args: unknown[] = []): void {
  outbox.push({ cmd, args });
  if (!flushQueued) {
    flushQueued = true;
    queueMicrotask(flush);
  }
}

/** A long command: it starts after the commands before it, and does not block the commands after it. */
function afterQueue<T>(cmd: string, args: unknown[] = []): Promise<T> {
  flush();
  return tail.then(() => call<T>(cmd, args));
}

// Events

type Listener = (body: never) => void;
const listeners = new Map<string, Set<Listener>>();
/** The control sockets that are open now (from the events). */
const openSockets = new Set<string>();

function dispatch(e: NearbyEvent): void {
  const body = e.body as { socketId?: string };
  if (e.event === 'onSocketOpen' && body.socketId) openSockets.add(body.socketId);
  if (e.event === 'onSocketClosed' && body.socketId) openSockets.delete(body.socketId);
  listeners.get(e.event)?.forEach((l) => {
    try {
      (l as (b: unknown) => void)(e.body);
    } catch (err) {
      console.warn(`[nearby] ${e.event} listener failed:`, err);
    }
  });
}

// Clock

/** native monotonic ms - performance.now(). */
let clockOffset = 0;

/** Measures the offset: 5 samples, the one with the shortest round trip wins. */
async function calibrate(): Promise<void> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < 5; i++) {
    const before = performance.now();
    const native = await call<number>('monotonicNow');
    const after = performance.now();
    const sample = { rtt: after - before, offset: native - (before + after) / 2 };
    if (!best || sample.rtt < best.rtt) best = sample;
  }
  if (best) clockOffset = best.offset;
}

// Stats

let lastStats: MediaStats = { served: 0, requests: 0, relayed: 0 };
let statsBusy = false;

function refreshStats(): void {
  if (statsBusy) return;
  statsBusy = true;
  call<MediaStats>('mediaStats')
    .then((s) => {
      lastStats = s;
    })
    .catch(() => undefined)
    .finally(() => {
      statsBusy = false;
    });
}

// Socket ids

let socketCount = 0;
const pageTag = Math.random().toString(36).slice(2, 8);

function newSocketId(): string {
  socketCount += 1;
  return `d-${pageTag}-${socketCount}`;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function makeLink(): NearbyLinkNative {
  return {
    platform: 'apple',
    monotonicNow: () => performance.now() + clockOffset,
    randomBytes(n) {
      const count = Math.max(1, Math.min(1024, Math.floor(n)));
      return base64(crypto.getRandomValues(new Uint8Array(count)));
    },

    // Host
    startServer: (serviceName, txt) => afterQueue<{ port: number; service: string }>('startServer', [serviceName, txt]),
    stopAdvertising: () => post('stopAdvertising'),
    shareFile: (urlPath, filePath, mimeType) => post('shareFile', [urlPath, filePath, mimeType]),
    setPace: (urlPath, bytesPerSecond) => post('setPace', [urlPath, bytesPerSecond]),
    unshareAll: () => post('unshareAll'),
    stopServer: () => post('stopServer'),

    // Guest
    startBrowsing: () => post('startBrowsing'),
    stopBrowsing: () => post('stopBrowsing'),
    connect(serviceId) {
      const id = newSocketId();
      post('connect', [serviceId, id]);
      return id;
    },
    connectAddress(host, port) {
      const id = newSocketId();
      post('connectAddress', [host, port, id]);
      return id;
    },
    mediaBase: (serviceId, host, port) => afterQueue<string>('mediaBase', [serviceId, host, port]),
    stopRelay: () => post('stopRelay'),

    // Both
    send(socketId, text) {
      if (!openSockets.has(socketId)) return false;
      post('send', [socketId, text]);
      return true;
    },
    // One batch entry for a broadcast, not one per guest.
    sendMany(socketIds, text) {
      const open = socketIds.filter((id) => openSockets.has(id));
      if (open.length) post('sendMany', [open, text]);
    },
    // Swift stamps t2 when the frame leaves, after the wait in the Tauri queue.
    sendPong(socketId, id, t0, t1) {
      if (!openSockets.has(socketId)) return false;
      post('sendPong', [socketId, id, t0, t1]);
      return true;
    },
    close: (socketId) => post('close', [socketId]),
    addresses: () => afterQueue<LinkAddress[]>('addresses'),
    stopAll() {
      openSockets.clear();
      post('stopAll');
    },
    mediaStats() {
      refreshStats();
      return lastStats;
    },

    // Bluetooth LE
    bleState: () => afterQueue<BleState>('bleState'),
    bleRequestPermission: () => afterQueue<BleState>('bleRequestPermission'),
    bleAdvertise: (info, localName) => post('bleAdvertise', [info, localName]),
    bleStopAdvertising: () => post('bleStopAdvertising'),
    bleScan: () => post('bleScan'),
    bleStopScan: () => post('bleStopScan'),
    // The real answer comes later; a failed send closes nothing, so true is the best guess.
    bleSend(peerId, text) {
      post('bleSend', [peerId, text]);
      return true;
    },
    bleDisconnect: (peerId) => post('bleDisconnect', [peerId]),
    bleStopAll: () => post('bleStopAll'),

    // Wi-Fi join
    joinWifi: (ssid, password) => afterQueue<null>('joinWifi', [ssid, password]).then(() => undefined),
    leaveWifi: (ssid) => post('leaveWifi', [ssid]),
    openSettings: () => post('openSettings'),

    on<K extends keyof LinkEvents>(name: K, listener: LinkEvents[K]) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener as Listener);
      return { remove: () => void set.delete(listener as Listener) };
    },
  };
}

/** True in the desktop app on a Mac (the transport is Swift). */
const isMacDesktop: boolean =
  isDesktop && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

/** The nearby transport of the macOS desktop app, else null. */
export const desktopLink: NearbyLinkNative | null = isMacDesktop ? makeLink() : null;

/** Resolves after the first clock measurement (at once outside the macOS desktop app). */
export const desktopLinkReady: Promise<void> = desktopLink
  ? calibrate().catch((e: unknown) => console.warn('[nearby] clock calibration failed:', e))
  : Promise.resolve();

if (desktopLink) {
  onNearbyEvent(dispatch);
  setInterval(() => void calibrate().catch(() => undefined), 60_000);
}
