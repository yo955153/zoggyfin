/**
 * Server addresses and the choice of the address to use. Pure, so it is
 * unit-tested; `connection.ts` runs it against the network.
 *
 * Rules:
 * - Probe every candidate address at the same time, with a short timeout.
 * - An address counts only when its server Id is the saved server Id, so the
 *   token never goes to a different server.
 * - The first address in the user's order that answers wins. The result comes
 *   as soon as it is known: a late answer from a lower address never waits
 *   for a higher one that already failed.
 */

export type AddressKind = 'internal' | 'external';

/** Automatic (default), or only addresses of one kind. */
export type ConnectionMode = 'auto' | AddressKind;

export interface ServerAddress {
  /** A normalized base URL, for example https://jellyfin.example.com. */
  url: string;
  kind: AddressKind;
}

export const PROBE_TIMEOUT_MS = 1500;

/** Why an address did not count. */
export type ProbeFailure = 'timeout' | 'unreachable' | 'wrong-server' | 'not-jellyfin' | 'mixed-content';

export type ProbeResult = { url: string; ok: true; ms: number } | { url: string; ok: false; reason: ProbeFailure };

/** Asks one address for its server Id (GET /System/Info/Public). Throws or rejects when it does not answer. */
export type ProbeFn = (url: string, timeoutMs: number) => Promise<{ id: string | null | undefined }>;

const PRIVATE_V4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
const LOCAL_SUFFIX = /\.(local|lan|home|internal|localdomain|home\.arpa)$/i;

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url);
  return (m?.[1] ?? '').toLowerCase();
}

/** A first guess for a new address: private IPs, `.local`-style names and one-label names are internal. */
export function guessKind(url: string): AddressKind {
  const host = hostOf(url);
  if (!host) return 'external';
  if (host === 'localhost') return 'internal';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return PRIVATE_V4.some((r) => r.test(host)) ? 'internal' : 'external';
  if (host.startsWith('[')) return /^\[(fc|fd|fe80|::1)/i.test(host) ? 'internal' : 'external';
  if (LOCAL_SUFFIX.test(host) || !host.includes('.')) return 'internal';
  return 'external';
}

/** Jellyfin writes Ids with and without dashes; compare them the same way. */
export function sameServerId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = (s: string) => s.replace(/-/g, '').toLowerCase();
  return n(a) === n(b);
}

/** An https page cannot call an http address (mixed content). */
export function blockedByMixedContent(url: string, pageIsHttps: boolean): boolean {
  return pageIsHttps && /^http:\/\//i.test(url);
}

/**
 * The order in which addresses are tried. `mode` keeps only one kind;
 * `preferred` (from the Wi-Fi rule, Automatic mode only) moves that kind to
 * the front and keeps the others as a fallback. The user's order holds inside each part.
 */
export function orderFor(addresses: readonly ServerAddress[], mode: ConnectionMode, preferred: AddressKind | null): ServerAddress[] {
  if (mode !== 'auto') return addresses.filter((a) => a.kind === mode);
  if (!preferred) return [...addresses];
  return [...addresses.filter((a) => a.kind === preferred), ...addresses.filter((a) => a.kind !== preferred)];
}

/** One probe with its own timeout, so a probe that ignores the timeout cannot hold up the choice. */
export async function probeOne(url: string, expectedId: string, probe: ProbeFn, timeoutMs: number, now: () => number = Date.now): Promise<ProbeResult> {
  const start = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(() => resolve({ url, ok: false, reason: 'timeout' }), timeoutMs);
  });
  const attempt = probe(url, timeoutMs).then(
    (info): ProbeResult => {
      if (!info.id) return { url, ok: false, reason: 'not-jellyfin' };
      if (!sameServerId(info.id, expectedId)) return { url, ok: false, reason: 'wrong-server' };
      return { url, ok: true, ms: now() - start };
    },
    (e: unknown): ProbeResult => {
      const code = (e as { code?: unknown } | null)?.code;
      return { url, ok: false, reason: code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'timeout' : 'unreachable' };
    },
  );
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AddressPick {
  /** The address to use, or null when none answered. */
  address: ServerAddress | null;
  /** Every result that is known when the choice is made. */
  results: ProbeResult[];
}

/**
 * Probes `ordered` in parallel and returns the first address in that order
 * that answers with the expected server Id. It returns as soon as every
 * address before the winner has failed.
 */
export function pickAddress(
  ordered: readonly ServerAddress[],
  expectedId: string,
  probe: ProbeFn,
  opts: { timeoutMs?: number; pageIsHttps?: boolean; onResult?: (r: ProbeResult) => void } = {},
): Promise<AddressPick> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  if (!ordered.length) return Promise.resolve({ address: null, results: [] });
  return new Promise((resolve) => {
    const slots: (ProbeResult | undefined)[] = ordered.map(() => undefined);
    let done = false;
    const settle = () => {
      if (done) return;
      for (let i = 0; i < ordered.length; i++) {
        const r = slots[i];
        if (!r) return; // An earlier address is still out: wait for it.
        if (r.ok) {
          done = true;
          resolve({ address: ordered[i], results: slots.filter((x): x is ProbeResult => !!x) });
          return;
        }
      }
      done = true;
      resolve({ address: null, results: slots as ProbeResult[] });
    };
    ordered.forEach((a, i) => {
      const run: Promise<ProbeResult> = blockedByMixedContent(a.url, !!opts.pageIsHttps)
        ? Promise.resolve({ url: a.url, ok: false, reason: 'mixed-content' })
        : probeOne(a.url, expectedId, probe, timeoutMs);
      void run.then((r) => {
        slots[i] = r;
        opts.onResult?.(r);
        settle();
      });
    });
  });
}

/** Adds an address at the end unless the list has it. Kind is guessed when not given. */
export function addAddress(list: readonly ServerAddress[], url: string, kind?: AddressKind): ServerAddress[] {
  if (list.some((a) => a.url === url)) return [...list];
  return [...list, { url, kind: kind ?? guessKind(url) }];
}

/** Moves the address at `from` to `to`, for the order buttons. */
export function moveAddress(list: readonly ServerAddress[], from: number, to: number): ServerAddress[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [a] = out.splice(from, 1);
  out.splice(to, 0, a);
  return out;
}

/** The text for one failed probe, for the address list. */
export function failureText(reason: ProbeFailure): string {
  switch (reason) {
    case 'timeout':
      return 'No answer';
    case 'unreachable':
      return 'Cannot connect';
    case 'wrong-server':
      return 'A different server answers here';
    case 'not-jellyfin':
      return 'Not a Jellyfin server';
    case 'mixed-content':
      return 'Blocked: this page uses https and this address uses http';
  }
}
