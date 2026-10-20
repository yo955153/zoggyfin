/**
 * The HTTP scan: asks every host of the subnet for `/System/Info/Public`,
 * many at a time, each with a short timeout. It stops at the deadline or when
 * the signal aborts. Servers come out as soon as they answer.
 */
import { parsePublicInfo } from './parse';
import type { DiscoveredServer } from './types';

export const SCAN_PORT = 8096;
export const SCAN_TIMEOUT_MS = 400;
export const SCAN_DEADLINE_MS = 4000;
export const SCAN_CONCURRENCY = 64;

/**
 * The deadline for a list of hosts: at least SCAN_DEADLINE_MS, and long enough
 * that every host gets one try when no host answers (each try waits for the
 * timeout). A /22 has 1022 hosts: 16 rounds of 64, about 6.9 s. With only 4 s,
 * a server far from the device on a /22 was never asked.
 */
export function scanDeadlineFor(hosts: number, concurrency = SCAN_CONCURRENCY, timeoutMs = SCAN_TIMEOUT_MS): number {
  const rounds = Math.ceil(hosts / Math.max(1, concurrency));
  return Math.max(SCAN_DEADLINE_MS, rounds * timeoutMs + 500);
}

/**
 * GETs a URL and gives the JSON body, or throws. It must give up after
 * `timeoutMs` and when `signal` aborts.
 */
export type FetchJson = (url: string, timeoutMs: number, signal: AbortSignal) => Promise<unknown>;

export interface ScanOptions {
  hosts: readonly string[];
  fetchJson: FetchJson;
  onFound: (server: DiscoveredServer) => void;
  signal: AbortSignal;
  /** Called for each host that answered at all (any HTTP answer, also an error status). */
  onAnswer?: (host: string) => void;
  port?: number;
  timeoutMs?: number;
  deadlineMs?: number;
  concurrency?: number;
}

export interface ScanResult {
  /** Hosts asked before the scan stopped. */
  asked: number;
  /** True when the deadline stopped the scan before the last host. */
  timedOut: boolean;
  aborted: boolean;
}

/** A signal that aborts when `parent` aborts or after `ms`. Call `done` to clear the timer. */
export function linkedSignal(parent: AbortSignal, ms: number): { signal: AbortSignal; done: () => void; expired: () => boolean } {
  const ctl = new AbortController();
  let expired = false;
  const onAbort = () => ctl.abort();
  const timer = setTimeout(() => {
    expired = true;
    ctl.abort();
  }, ms);
  if (parent.aborted) ctl.abort();
  else parent.addEventListener('abort', onAbort);
  return {
    signal: ctl.signal,
    done: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
    expired: () => expired,
  };
}

export async function scanHosts(o: ScanOptions): Promise<ScanResult> {
  const port = o.port ?? SCAN_PORT;
  const timeoutMs = o.timeoutMs ?? SCAN_TIMEOUT_MS;
  const all = linkedSignal(o.signal, o.deadlineMs ?? scanDeadlineFor(o.hosts.length, o.concurrency, timeoutMs));
  let next = 0;
  let asked = 0;
  const worker = async () => {
    while (!all.signal.aborted && next < o.hosts.length) {
      const host = o.hosts[next++];
      asked++;
      const url = `http://${host}:${port}`;
      const one = linkedSignal(all.signal, timeoutMs);
      try {
        const body = await o.fetchJson(`${url}/System/Info/Public`, timeoutMs, one.signal);
        o.onAnswer?.(host);
        if (all.signal.aborted) break;
        const server = parsePublicInfo(url, body);
        if (server) o.onFound(server);
      } catch (e) {
        // An HTTP error status still proves that the network lets the app through.
        if ((e as { status?: unknown } | null)?.status !== undefined) o.onAnswer?.(host);
      } finally {
        one.done();
      }
    }
  };
  const n = Math.max(1, Math.min(o.concurrency ?? SCAN_CONCURRENCY, o.hosts.length));
  await Promise.all(Array.from({ length: n }, worker));
  all.done();
  return { asked, timedOut: all.expired() && next < o.hosts.length, aborted: o.signal.aborted };
}
