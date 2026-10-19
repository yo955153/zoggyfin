/**
 * Server reachability. The app is "offline" when the signed-in server does
 * not answer /System/Ping, whatever the cause (no network, a plane, the
 * server is down). Checks run at start, when the network changes, when the
 * app comes to the front, and every 30 s while offline.
 */
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { ping } from '@/api/jellyfin';
import { useSessionStore } from '@/auth/session-store';

interface OnlineState {
  /** null until the first check. */
  reachable: boolean | null;
  checkedAt: number;
  /** Counts the changes to offline (the banner comes back on each one). */
  offlineCount: number;
}

export const useOnlineStore = create<OnlineState>(() => ({ reachable: null, checkedAt: 0, offlineCount: 0 }));

/** True only when a check failed: unknown counts as online, so a cold start does not flash the banner. */
export function useOffline(): boolean {
  return useOnlineStore((s) => s.reachable === false);
}

export function isOffline(): boolean {
  return useOnlineStore.getState().reachable === false;
}

let checking: Promise<boolean> | null = null;

/** Pings the server now. Concurrent calls share one request. */
export function checkServer(): Promise<boolean> {
  const s = useSessionStore.getState().session;
  if (!s) return Promise.resolve(true);
  checking ??= ping(s.serverUrl).then((ok) => {
    checking = null;
    const prev = useOnlineStore.getState();
    useOnlineStore.setState({
      reachable: ok,
      checkedAt: Date.now(),
      offlineCount: !ok && prev.reachable !== false ? prev.offlineCount + 1 : prev.offlineCount,
    });
    return ok;
  });
  return checking;
}

/** A request failed with a network error: check again soon, the server may be gone. */
export function reportNetworkError(): void {
  if (Date.now() - useOnlineStore.getState().checkedAt > 5000) void checkServer();
}

let started = false;

export function startReachability(): void {
  if (started) return;
  started = true;
  void checkServer();
  try {
    Network.addNetworkStateListener(() => void checkServer());
  } catch {
    // Web without the Network Information API: the timer and AppState still run.
  }
  AppState.addEventListener('change', (st) => {
    if (st === 'active') void checkServer();
  });
  setInterval(() => {
    const { reachable, checkedAt } = useOnlineStore.getState();
    const every = reachable === false ? 30_000 : 120_000;
    if (Date.now() - checkedAt >= every) void checkServer();
  }, 10_000);
}
