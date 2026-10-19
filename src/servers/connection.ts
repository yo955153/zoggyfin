/**
 * Picks the address to use for a saved server and keeps the choice current.
 * `checkConnection()` probes the server's addresses in parallel (see
 * `addresses.ts`), applies the mode and the Wi-Fi rule, and hands the result
 * to the session store. The API client, image URLs, stream URLs and the
 * downloader all read the address from the session, so a switch takes effect
 * at once. `lib/online.ts` runs the checks: at start, on foreground, on a
 * network change, on a request with no answer, and every 2 minutes.
 */
import axios from 'axios';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { findServer } from '@/auth/accounts';
import { useSessionStore } from '@/auth/session-store';
import { devOffline, offlineError } from '@/lib/dev-offline';

import { orderFor, pickAddress, type ProbeFn, type ProbeResult } from './addresses';
import { networkSource } from './network-source';
import { type ConnectionInfo, UNKNOWN_CONNECTION } from './status';
import { wifiPreference } from './wifi-rule';

export type { ConnectionInfo } from './status';

export const useConnectionStore = create<{ byServer: Record<string, ConnectionInfo> }>(() => ({ byServer: {} }));

export function connectionOf(serverId: string | null | undefined): ConnectionInfo {
  return (serverId && useConnectionStore.getState().byServer[serverId]) || UNKNOWN_CONNECTION;
}

export function useConnection(serverId: string | null | undefined): ConnectionInfo {
  return useConnectionStore((s) => (serverId && s.byServer[serverId]) || UNKNOWN_CONNECTION);
}

function patch(serverId: string, fn: (c: ConnectionInfo) => ConnectionInfo) {
  useConnectionStore.setState((s) => ({ byServer: { ...s.byServer, [serverId]: fn(s.byServer[serverId] ?? UNKNOWN_CONNECTION) } }));
}

/** GET /System/Info/Public with no credentials: it tells the server Id. */
export const probeSystemInfo: ProbeFn = async (url, timeoutMs) => {
  if (devOffline()) throw offlineError();
  const res = await axios.get<{ Id?: string | null }>(`${url}/System/Info/Public`, { timeout: timeoutMs });
  return { id: res.data?.Id ?? null };
};

export function pageIsHttps(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.protocol === 'https:';
}

const running = new Map<string, Promise<boolean>>();

/** Checks the addresses of a server (the active one when no Id is given). True when one answers. Concurrent calls share one check. */
export function checkConnection(serverId?: string): Promise<boolean> {
  const id = serverId ?? useSessionStore.getState().session?.serverId;
  if (!id) return Promise.resolve(true);
  const busy = running.get(id);
  if (busy) return busy;
  const p = run(id).finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

async function run(serverId: string): Promise<boolean> {
  const server = findServer(useSessionStore.getState().accounts, serverId);
  if (!server) return false;
  patch(serverId, (c) => ({ ...c, checking: true }));
  const net = server.mode === 'auto' && server.wifi.enabled && networkSource.available ? await networkSource.snapshot() : null;
  const wanted = server.mode === 'auto' ? wifiPreference(server.wifi, net) : null;
  const ordered = orderFor(server.addresses, server.mode, wanted);
  const results: Record<string, ProbeResult> = {};
  const pick = await pickAddress(ordered, server.id, probeSystemInfo, {
    pageIsHttps: pageIsHttps(),
    // Late answers still update the address list in Settings.
    onResult: (r) => {
      results[r.url] = r;
      patch(serverId, (c) => ({ ...c, results: { ...c.results, [r.url]: r } }));
    },
  });
  if (pick.address) useSessionStore.getState().setServerUrl(serverId, pick.address.url);
  patch(serverId, (c) => ({
    ...c,
    checking: false,
    status: pick.address ? 'connected' : 'unreachable',
    url: pick.address?.url ?? null,
    kind: pick.address?.kind ?? null,
    wanted,
    // Addresses that are not in the list any more drop out.
    results: Object.fromEntries(Object.entries({ ...c.results, ...results }).filter(([url]) => server.addresses.some((a) => a.url === url))),
    checkedAt: Date.now(),
  }));
  if (__DEV__) console.log(`[connection] ${server.name}: ${pick.address ? `${pick.address.kind} ${pick.address.url}` : 'no address answers'}`);
  return !!pick.address;
}
