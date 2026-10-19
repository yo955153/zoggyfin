/**
 * One discovery run: the UDP broadcast and the HTTP scan at the same time.
 * Servers come out as they are found, merged by Id. The run stops by itself
 * after the scan deadline, or at once when the signal aborts.
 */
import type { DiscoveryBackend, LocalInterface } from './backend-types';
import { FAST_FAIL_MS, inferLanAccess, type LanAccess } from './lan-access';
import { mergeServer } from './merge';
import { parsePublicInfo, parseUdpAnswer } from './parse';
import { SCAN_DEADLINE_MS, scanHosts } from './scan';
import { MIN_PREFIX, subnetHosts } from './subnet';
import type { DiscoveredServer } from './types';

/** How long the UDP step collects answers. */
export const UDP_WAIT_MS = 2000;
/** The most hosts one run asks, over all interfaces: one /22. */
export const MAX_HOSTS = 2 ** (32 - MIN_PREFIX) - 2;

export interface DiscoveryResult {
  servers: DiscoveredServer[];
  lan: LanAccess;
  aborted: boolean;
}

/** The hosts to scan: the subnets of the interfaces in order, no duplicates, at most `MAX_HOSTS`. */
export function hostsToScan(interfaces: readonly LocalInterface[], max = MAX_HOSTS): string[] {
  // The device's own addresses are never scanned.
  const seen = new Set<string>(interfaces.map((i) => i.address));
  const out: string[] = [];
  for (const i of interfaces) {
    const range = subnetHosts(i.address, i.prefix ?? i.netmask);
    if (!range) continue;
    for (const h of range.hosts) {
      if (out.length >= max) return out;
      if (!seen.has(h)) {
        seen.add(h);
        out.push(h);
      }
    }
  }
  return out;
}

export async function runDiscovery(
  backend: DiscoveryBackend,
  o: { signal: AbortSignal; onServers: (servers: DiscoveredServer[]) => void; deadlineMs?: number; now?: () => number },
): Promise<DiscoveryResult> {
  const now = o.now ?? Date.now;
  let servers: DiscoveredServer[] = [];
  let lanAnswered = false;
  let fastFailures = 0;
  let finished = 0;
  let udpBlocked = false;
  const add = (s: DiscoveredServer) => {
    if (o.signal.aborted) return;
    const next = mergeServer(servers, s);
    if (next !== servers) {
      servers = next;
      o.onServers(servers);
    }
  };

  const udpStep = async () => {
    if (!backend.udpSupported) return;
    const r = await backend.udp(UDP_WAIT_MS).catch(() => ({ answers: [] as string[], blocked: false }));
    udpBlocked = r.blocked;
    const found = r.answers.map(parseUdpAnswer).filter((s): s is DiscoveredServer => s !== null);
    if (found.length) lanAnswered = true;
    found.forEach(add);
    // A UDP answer has no version: ask each server once.
    await Promise.all(
      found.map(async (s) => {
        if (o.signal.aborted) return;
        const body = await backend.fetchJson(`${s.address}/System/Info/Public`, 1500, o.signal).catch(() => null);
        const info = parsePublicInfo(s.address, body);
        if (info && info.id.replace(/-/g, '').toLowerCase() === s.id.replace(/-/g, '').toLowerCase()) {
          add({ ...info, address: s.address, source: 'udp' });
        }
      }),
    );
  };

  const scanStep = async () => {
    const interfaces = await backend.interfaces().catch(() => [] as LocalInterface[]);
    const hosts = hostsToScan(interfaces);
    if (!hosts.length || o.signal.aborted) return;
    await scanHosts({
      hosts,
      signal: o.signal,
      deadlineMs: o.deadlineMs ?? SCAN_DEADLINE_MS,
      fetchJson: async (url, timeoutMs, signal) => {
        const t0 = now();
        try {
          return await backend.fetchJson(url, timeoutMs, signal);
        } catch (e) {
          if (!signal.aborted && now() - t0 < FAST_FAIL_MS) fastFailures++;
          throw e;
        } finally {
          if (!signal.aborted || now() - t0 >= timeoutMs) finished++;
        }
      },
      onAnswer: () => {
        lanAnswered = true;
      },
      onFound: add,
    });
  };

  await Promise.all([udpStep(), scanStep()]);
  const lan = inferLanAccess({ native: udpBlocked ? 'denied' : 'unknown', lanAnswered, fastFailures, finished });
  return { servers, lan, aborted: o.signal.aborted };
}
