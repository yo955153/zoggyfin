/**
 * Local network access (iOS 14+ and macOS 15+). The system asks the user the
 * first time the app talks to the local network. A request that runs while
 * the prompt is open, or after a "Don't Allow", fails as a network error.
 * These helpers decide when to retry and when to show the help.
 */
import { describeError } from '@/api/errors';

import { classifyAddress, isTenNet } from '../address-class';

/** The wait before the one retry: time for the user to answer a prompt that is still open. */
export const LAN_RETRY_MS = 1500;

/** What the app knows about local network access. */
export type LanAccess = 'unknown' | 'granted' | 'denied';

/** True for an address on the local network (see `classifyAddress`). Tailscale addresses are a VPN, not the local network. */
export function isPrivateAddress(url: string): boolean {
  return classifyAddress(url) === 'lan';
}

/** True when the error is a network failure (no HTTP answer at all). A timeout is not: something answered slowly or the host is off. */
export function isNetworkFailure(e: unknown): boolean {
  return describeError(e).kind === 'offline';
}

/** True when a failed request to `url` gets one retry and then the local network help. */
export function lanHelpApplies(url: string, e: unknown): boolean {
  return isPrivateAddress(url) && isNetworkFailure(e);
}

/**
 * Runs `fn`. When it fails with a network error and `url` is a private
 * address, waits `delayMs` and runs it one more time. A cancel is not retried.
 */
export async function withLanRetry<T>(
  url: string,
  fn: () => Promise<T>,
  opts: { delayMs?: number; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal } = {},
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (opts.signal?.aborted || !lanHelpApplies(url, e)) throw e;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(opts.delayMs ?? LAN_RETRY_MS);
    if (opts.signal?.aborted) throw e;
    return fn();
  }
}

/**
 * The help to show for a failed request, or null for the usual message.
 * - `lan-access`: local network access is likely off (iOS, macOS).
 * - `lan-access-vpn`: the same, and a VPN is up (a 10.x address can be a WireGuard network).
 * - `vpn`: a 10.x address fails while a VPN is up, on a platform with no local network prompt.
 * - `tailscale`: a Tailscale address fails: Tailscale is likely not connected.
 */
export type LanHelp = 'lan-access' | 'lan-access-vpn' | 'vpn' | 'tailscale';

export function lanHelpFor(url: string, e: unknown, platformAsks: boolean, vpnActive = false): LanHelp | null {
  if (!isNetworkFailure(e)) return null;
  const kind = classifyAddress(url);
  if (kind === 'tailscale') return 'tailscale';
  if (kind !== 'lan') return null;
  const vpn = vpnActive && isTenNet(url);
  if (platformAsks) return vpn ? 'lan-access-vpn' : 'lan-access';
  return vpn ? 'vpn' : null;
}

export interface LanEvidence {
  /** What the native check said (iOS: NWBrowser; macOS: the UDP send). */
  native: LanAccess;
  /** Any host on the local network answered (an HTTP answer or a UDP answer). */
  lanAnswered: boolean;
  /** Probes that failed in less than `FAST_FAIL_MS`, and all probes that ended. */
  fastFailures: number;
  finished: number;
}

/** A refused local network request fails at once; a host that is off takes until the timeout. */
export const FAST_FAIL_MS = 60;

/**
 * Local network access from what the app saw. Any LAN answer means granted.
 * A denial from the native check means denied. With no native check, almost
 * every probe failing at once means denied too.
 */
export function inferLanAccess(e: LanEvidence): LanAccess {
  if (e.lanAnswered) return 'granted';
  if (e.native === 'denied') return 'denied';
  if (e.native === 'granted') return 'granted';
  if (e.finished >= 20 && e.fastFailures / e.finished >= 0.9) return 'denied';
  return 'unknown';
}
