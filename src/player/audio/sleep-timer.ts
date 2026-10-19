/**
 * The sleep timer: pause after some minutes, or at the end of the current
 * chapter (or track when the item has no chapters). Pure: time comes in as a
 * number, so it is unit-tested.
 */

export type SleepTimer =
  | { kind: 'off' }
  | { kind: 'minutes'; minutes: number; endsAt: number }
  | { kind: 'end'; itemKey: string; chapterEnd: number | null };

export const SLEEP_MINUTES = [5, 15, 30, 45, 60] as const;

export const sleepOff: SleepTimer = { kind: 'off' };

export function sleepFor(minutes: number, now: number): SleepTimer {
  return { kind: 'minutes', minutes, endsAt: now + minutes * 60_000 };
}

/** Stop at the end of the current chapter (`chapterEnd` in seconds) or, with null, the end of the track. */
export function sleepAtEnd(itemKey: string, chapterEnd: number | null): SleepTimer {
  return { kind: 'end', itemKey, chapterEnd };
}

/** Milliseconds left for a minutes timer; null for the other kinds. */
export function sleepRemaining(t: SleepTimer, now: number): number | null {
  return t.kind === 'minutes' ? Math.max(0, t.endsAt - now) : null;
}

export interface SleepCheck {
  now: number;
  /** The current queue entry and its position in seconds. */
  itemKey: string | null;
  position: number;
  /** True when the current track just ended (before the next starts). */
  trackEnded: boolean;
}

/** True when playback must pause now. */
export function sleepDue(t: SleepTimer, c: SleepCheck): boolean {
  switch (t.kind) {
    case 'off':
      return false;
    case 'minutes':
      return c.now >= t.endsAt;
    case 'end':
      if (t.chapterEnd !== null && c.itemKey === t.itemKey) return c.position >= t.chapterEnd - 0.25;
      // The track ended, or the queue moved to another entry.
      return c.trackEnded || (c.itemKey !== null && c.itemKey !== t.itemKey);
  }
}

/** "28:00", or "1:00:00" for an hour or more. Rounded up, so it never shows 0:00 while running. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Volume for a gentle fade over the last `fadeMs` of a minutes timer (1 when not fading). */
export function sleepFadeVolume(t: SleepTimer, now: number, fadeMs = 10_000): number {
  if (t.kind !== 'minutes') return 1;
  const left = t.endsAt - now;
  if (left >= fadeMs) return 1;
  return Math.max(0, left / fadeMs);
}
