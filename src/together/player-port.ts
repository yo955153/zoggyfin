/**
 * What the together controllers need from a player. The app binds it to the
 * video session (`player-binding.ts`); tests use a fake.
 *
 * Calls on the port change the player directly. They never go back through
 * the control gate, so a remote command does not echo.
 */
import type { DriftOptions } from './drift';

export interface PlayerPort {
  /** Seconds. */
  position(): number;
  isPlaying(): boolean;
  /** True while the player waits for data. */
  isBuffering(): boolean;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  /** Called with true / false when buffering starts or stops. */
  onBuffering(listener: (buffering: boolean) => void): () => void;
  /** Audio: the key of the queue entry that plays now. Video players leave it out. */
  track?(): string | null;
  /** The player was reloaded: take its real play state again (the follower calls it on attach). */
  resync?(): void;
  /** How to correct drift on this player, when the default does not suit it. */
  drift?: DriftOptions;
}

/**
 * A player that differs from what the app asked must still differ this long
 * before the change counts as one from outside the app, ms. The engine
 * reports each change late (libmpv through the Tauri bridge most of all), so
 * a report can still say "playing" just after the app paused. Such a report
 * is old: the next report agrees with the app again within this time.
 */
export const OUTSIDE_CONFIRM = 250;

/** Timers, so tests can run on a fake clock. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};
