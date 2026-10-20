/**
 * The host's guard against strangers in a nearby session (a plane, a
 * café): who may ask to join, how often, and how many can be in. The host
 * runs every join request through this gate before the user sees it; the
 * link refuses at once, with a reason the guest shows. Pure: a clock in,
 * decisions out.
 *
 * Devices are known by the device key that each guest sends (one for each
 * session, kept in secure storage: device-key.ts), else by its member id
 * (new on each launch), else by the socket's peer id. Never by name.
 */

/** Most guests in one session. */
export const MAX_GUESTS = 16;
/** The host sees this many requests; the rest show as "+N more". */
export const SHOWN_REQUESTS = 3;
/** Requests that wait longer than this are refused, ms. */
export const REQUEST_TTL = 60_000;
/** Each device may ask this often per window. */
export const DEVICE_RATE = { max: 3, windowMs: 60_000 };
/** All devices together may ask this often per window. */
export const TOTAL_RATE = { max: 12, windowMs: 10_000 };
/** At most this many requests wait at once (memory guard). */
export const MAX_PENDING = 24;

export type Refusal = 'blocked' | 'locked' | 'full' | 'duplicate' | 'rate' | 'declined' | 'timeout' | 'removed' | 'removed-blocked';

/** What the guest reads when the host says no. */
export const REFUSAL_TEXT: Record<Refusal, string> = {
  blocked: 'The host does not allow this device in this session.',
  locked: 'The host does not allow new people in this session now.',
  full: `This session is full (${MAX_GUESTS} people).`,
  duplicate: 'You already asked to join. Wait for the host to answer.',
  rate: 'Too many tries. Wait a minute, then try again.',
  declined: 'The host did not let you join.',
  timeout: 'The host did not answer in time.',
  removed: 'The host removed you from the session.',
  'removed-blocked': 'The host removed you and blocked this device for this session.',
};

/** True when a reason from the host means "stop trying" (the guest does not reconnect). */
export function isFinalRefusal(reason: string | null | undefined): boolean {
  return reason === REFUSAL_TEXT.blocked || reason === REFUSAL_TEXT.removed || reason === REFUSAL_TEXT['removed-blocked'];
}

export interface PendingRequest {
  peerId: string;
  device: string;
  at: number;
}

export interface GateFacts {
  /** Guests in the session now (away members count: they keep a place). */
  guests: number;
  /** Requests that wait for the host now. */
  pending: readonly PendingRequest[];
}

/** The device key of a join request: its device key, else its member id, else its peer id. */
export function deviceKey(peerId: string, memberId?: string | null, device?: string | null): string {
  if (device) return `d:${device}`;
  return memberId ? `m:${memberId}` : `p:${peerId}`;
}

export class JoinGate {
  /** "Don't allow new people". */
  locked = false;
  private blocked = new Set<string>();
  private removed = new Set<string>();
  private attempts = new Map<string, number[]>();
  private all: number[] = [];

  constructor(private readonly now: () => number) {}

  /**
   * A new join request (no valid session key). Returns why it is refused,
   * or null when the host may see it. Each call counts toward the rate
   * limits, refused or not.
   */
  screen(device: string, facts: GateFacts): Refusal | null {
    const t = this.now();
    const mine = this.count(this.attempts.get(device) ?? [], t, DEVICE_RATE.windowMs);
    this.attempts.set(device, [...mine, t]);
    this.all = [...this.count(this.all, t, TOTAL_RATE.windowMs), t];
    if (this.blocked.has(device)) return 'blocked';
    if (this.locked) return 'locked';
    if (facts.guests >= MAX_GUESTS) return 'full';
    if (facts.pending.some((p) => p.device === device)) return 'duplicate';
    if (mine.length >= DEVICE_RATE.max) return 'rate';
    if (this.all.length > TOTAL_RATE.max || facts.pending.length >= MAX_PENDING) return 'rate';
    return null;
  }

  /**
   * A guest with the session key (it comes back after a drop). It gets in
   * with no new request unless the host removed or blocked it.
   */
  screenReturn(device: string): Refusal | 'ask' | null {
    if (this.blocked.has(device)) return 'blocked';
    if (this.removed.has(device)) return this.locked ? 'locked' : 'ask';
    return null;
  }

  /** The host removed a member. With `block`, its requests are refused from now on. */
  remove(device: string, block: boolean): void {
    this.removed.add(device);
    if (block) this.blocked.add(device);
  }

  isBlocked(device: string): boolean {
    return this.blocked.has(device);
  }

  /** The requests that waited too long. */
  expired(pending: readonly PendingRequest[]): PendingRequest[] {
    const t = this.now();
    return pending.filter((p) => t - p.at >= REQUEST_TTL);
  }

  private count(list: number[], t: number, windowMs: number): number[] {
    return list.filter((x) => t - x < windowMs);
  }
}

/** The requests that the host sees, and how many more wait. */
export function visibleRequests<T>(all: readonly T[]): { shown: T[]; more: number } {
  return { shown: all.slice(0, SHOWN_REQUESTS), more: Math.max(0, all.length - SHOWN_REQUESTS) };
}

export type Findable = 'anyone' | 'code';

/**
 * Who can find a new session by default. On a network that looks public (a
 * hotspot, mobile data, no Wi-Fi, an unknown network), only people with the
 * code; on a home or office Wi-Fi or Ethernet, anyone nearby.
 */
export function defaultFindable(i: { networkType: string | null | undefined; hotspot: boolean }): Findable {
  if (i.hotspot) return 'code';
  return i.networkType === 'wifi' || i.networkType === 'ethernet' ? 'anyone' : 'code';
}
