/**
 * When a live channel that already played fails (the provider sends broken or
 * late data, and the player stops with "stuck playing" or a decoder error),
 * the session starts the channel again by itself. It gives up after a few
 * restarts in a short time, so a channel that is really down shows its
 * message instead of looping.
 *
 * Pure, so it is unit-tested.
 */

/** Restarts allowed within `LIVE_RESTART_WINDOW_MS` before the error shows. */
export const LIVE_RESTART_LIMIT = 3;
export const LIVE_RESTART_WINDOW_MS = 120_000;

export interface LiveRestarts {
  /** The channel the restarts belong to. */
  key: string;
  /** The times of the recent restarts (ms). */
  times: readonly number[];
}

/**
 * Decides on a restart for a failed channel. Returns the new record when the
 * channel may restart, or null when the error must show.
 */
export function nextLiveRestart(prev: LiveRestarts | null, key: string, now: number): LiveRestarts | null {
  const recent = prev && prev.key === key ? prev.times.filter((t) => now - t < LIVE_RESTART_WINDOW_MS) : [];
  if (recent.length >= LIVE_RESTART_LIMIT) return null;
  return { key, times: [...recent, now] };
}
