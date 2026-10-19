/**
 * What the together controllers need from a player. The app binds it to the
 * video session (`player-binding.ts`); tests use a fake.
 *
 * Calls on the port change the player directly. They never go back through
 * the control gate, so a remote command does not echo.
 */

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
}

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
