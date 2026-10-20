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
 * Order: Tauri can run two calls in parallel, so the order of arrival is not
 * sure. The short commands go one after the other here: each waits for the
 * answer of the command before it (the answer comes at once). A long command
 * (`startServer`, `mediaBase`, the BLE state, `joinWifi`, `addresses`) waits
 * for the commands before it, but the commands after it do not wait for it.
 */
import { invoke, isDesktop, type NearbyEvent, onNearbyEvent } from '@/platform/desktop';

import type { BleState, LinkAddress, LinkEvents, MediaStats, NearbyLinkNative } from './link-native-types';

function call<T>(cmd: string, args: unknown[] = []): Promise<T> {
  return invoke<T>('nearby_call', { cmd, args });
}

/** The end of the queue of short commands. */
let tail: Promise<unknown> = Promise.resolve();

/** A short command, in order after the commands before it. Errors go to the log. */
function queued<T>(cmd: string, args: unknown[] = []): Promise<T | undefined> {
  const run = tail.then(
    () => call<T>(cmd, args),
    () => call<T>(cmd, args),
  );
  tail = run.catch(() => undefined);
  return run.catch((e: unknown) => {
    console.warn(`[nearby] ${cmd} failed:`, e);
    return undefined;
  });
}

/** A long command: it starts after the queued commands before it, and does not block the queue. */
function afterQueue<T>(cmd: string, args: unknown[] = []): Promise<T> {
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
    stopAdvertising: () => void queued('stopAdvertising'),
    shareFile: (urlPath, filePath, mimeType) => void queued('shareFile', [urlPath, filePath, mimeType]),
    setPace: (urlPath, bytesPerSecond) => void queued('setPace', [urlPath, bytesPerSecond]),
    unshareAll: () => void queued('unshareAll'),
    stopServer: () => void queued('stopServer'),

    // Guest
    startBrowsing: () => void queued('startBrowsing'),
    stopBrowsing: () => void queued('stopBrowsing'),
    connect(serviceId) {
      const id = newSocketId();
      void queued('connect', [serviceId, id]);
      return id;
    },
    connectAddress(host, port) {
      const id = newSocketId();
      void queued('connectAddress', [host, port, id]);
      return id;
    },
    mediaBase: (serviceId, host, port) => afterQueue<string>('mediaBase', [serviceId, host, port]),
    stopRelay: () => void queued('stopRelay'),

    // Both
    send(socketId, text) {
      if (!openSockets.has(socketId)) return false;
      void queued('send', [socketId, text]);
      return true;
    },
    close: (socketId) => void queued('close', [socketId]),
    addresses: () => afterQueue<LinkAddress[]>('addresses'),
    stopAll() {
      openSockets.clear();
      void queued('stopAll');
    },
    mediaStats() {
      refreshStats();
      return lastStats;
    },

    // Bluetooth LE
    bleState: () => afterQueue<BleState>('bleState'),
    bleRequestPermission: () => afterQueue<BleState>('bleRequestPermission'),
    bleAdvertise: (info, localName) => void queued('bleAdvertise', [info, localName]),
    bleStopAdvertising: () => void queued('bleStopAdvertising'),
    bleScan: () => void queued('bleScan'),
    bleStopScan: () => void queued('bleStopScan'),
    // The real answer comes later; a failed send closes nothing, so true is the best guess.
    bleSend(peerId, text) {
      void queued('bleSend', [peerId, text]);
      return true;
    },
    bleDisconnect: (peerId) => void queued('bleDisconnect', [peerId]),
    bleStopAll: () => void queued('bleStopAll'),

    // Wi-Fi join
    joinWifi: (ssid, password) => afterQueue<null>('joinWifi', [ssid, password]).then(() => undefined),
    leaveWifi: (ssid) => void queued('leaveWifi', [ssid]),
    openSettings: () => void queued('openSettings'),

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
