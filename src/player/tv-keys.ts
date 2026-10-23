/**
 * TV remote keys in the video player. Pure: no React, so it is unit-tested.
 *
 * A single Left or Right press keeps its normal job (it shows the controls,
 * and the focus engine moves the focus). A second press of the same key
 * within DOUBLE_PRESS_MS also seeks 10 s. Every further pair seeks again, and
 * the on-screen feedback adds up while it shows.
 */

/** Two presses of the same key closer than this are a double press (ms). */
export const DOUBLE_PRESS_MS = 350;

/** How far a double Left or Right seeks (s). */
export const DOUBLE_PRESS_SEEK = 10;

/** The remote keys the player knows. */
export type TvKey =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'select'
  | 'playPause'
  | 'play'
  | 'pause'
  | 'rewind'
  | 'fastForward'
  | 'back';

const TV_EVENT_KEYS: Record<string, TvKey> = {
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
  select: 'select',
  playPause: 'playPause',
  play: 'play',
  pause: 'pause',
  rewind: 'rewind',
  fastForward: 'fastForward',
};

/**
 * The key of a react-native-tvos remote event. Android sends a key-down
 * (eventKeyAction 0) and a key-up (1) for each press: only the key-down counts.
 */
export function tvKeyFromEvent(e: { eventType?: string; eventKeyAction?: number | string | null }): TvKey | null {
  if (Number(e.eventKeyAction) === 1) return null;
  return (e.eventType && TV_EVENT_KEYS[e.eventType]) || null;
}

const WEB_KEYS: Record<string, TvKey> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ' ': 'playPause',
  k: 'playPause',
  Escape: 'back',
};

/** The key of a keyboard press in the web TV preview. */
export function tvKeyFromWeb(key: string): TvKey | null {
  return WEB_KEYS[key] ?? null;
}

/** The last press that has not been paired yet. */
export interface PressMemory {
  key: string | null;
  at: number;
}

export const NO_PRESS: PressMemory = { key: null, at: 0 };

/**
 * Records a press. `double` is true when it pairs with the previous press of
 * the same key; the pair is then used up, so a third press starts a new pair.
 */
export function registerPress(
  prev: PressMemory,
  key: string,
  now: number,
  windowMs: number = DOUBLE_PRESS_MS,
): { double: boolean; memory: PressMemory } {
  const gap = now - prev.at;
  if (prev.key === key && gap >= 0 && gap <= windowMs) return { double: true, memory: NO_PRESS };
  return { double: false, memory: { key, at: now } };
}

/** A small stateful wrapper around registerPress. */
export function createDoublePress(windowMs: number = DOUBLE_PRESS_MS) {
  let memory = NO_PRESS;
  return {
    press(key: string, now: number = Date.now()): boolean {
      const r = registerPress(memory, key, now, windowMs);
      memory = r.memory;
      return r.double;
    },
    reset(): void {
      memory = NO_PRESS;
    },
  };
}

export type PlayerKeyAction =
  | { type: 'seek'; seconds: number }
  | { type: 'skip'; direction: 'back' | 'forward' }
  | { type: 'togglePlay' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'close' }
  | { type: 'wake' }
  | { type: 'none' };

/**
 * What a remote key does in the player. Select is left to the focused
 * control (a button, or the full-screen layer while the controls are hidden).
 */
export function playerKeyAction(key: TvKey, double: boolean): PlayerKeyAction {
  switch (key) {
    case 'left':
      return double ? { type: 'seek', seconds: -DOUBLE_PRESS_SEEK } : { type: 'wake' };
    case 'right':
      return double ? { type: 'seek', seconds: DOUBLE_PRESS_SEEK } : { type: 'wake' };
    case 'up':
    case 'down':
      return { type: 'wake' };
    case 'playPause':
      return { type: 'togglePlay' };
    case 'play':
      return { type: 'play' };
    case 'pause':
      return { type: 'pause' };
    case 'rewind':
      return { type: 'skip', direction: 'back' };
    case 'fastForward':
      return { type: 'skip', direction: 'forward' };
    case 'back':
      return { type: 'close' };
    case 'select':
      return { type: 'none' };
  }
}

/** The seek feedback ("−20 s"): presses on the same side add up while it shows. */
export interface SeekFeedback {
  side: 'left' | 'right';
  seconds: number;
  key: number;
}

export function stackFeedback(prev: SeekFeedback | null, side: 'left' | 'right', seconds: number): SeekFeedback {
  const step = Math.abs(seconds);
  return {
    side,
    seconds: prev && prev.side === side ? prev.seconds + step : step,
    key: (prev?.key ?? 0) + 1,
  };
}

// ---------------------------------------------------------------------------
// Scrubbing with the remote (the seek bar has the focus)
// ---------------------------------------------------------------------------

/** The scrub seeks this long after the last Left or Right press (ms). Select seeks at once. */
export const SCRUB_COMMIT_MS = 800;

/** Presses closer than this (ms) in the same direction are one run (a held key). */
export const SCRUB_RUN_MS = 600;

/** At most one step per this long (ms), whatever the remote's key-repeat rate: about 7 a second. */
export const SCRUB_MIN_GAP_MS = 140;

/** A run of Left or Right presses on the seek bar (a held key repeats). */
export interface ScrubRun {
  dir: -1 | 0 | 1;
  /** When the run began (ms). */
  start: number;
  /** The last press (ms). */
  at: number;
  /** The last press that moved the target (ms). */
  applied: number;
}

export const NO_RUN: ScrubRun = { dir: 0, start: 0, at: 0, applied: 0 };

/** The step for a key held this long (ms): 10 s for 1.5 s, then 30 s, and 60 s after 4 s. A tap is 10 s. */
export function scrubStep(heldMs: number): number {
  if (heldMs < 1500) return 10;
  if (heldMs < 4000) return 30;
  return 60;
}

/** Records a press. `apply` is false for a repeat that comes too soon after the last step. */
export function nextRun(run: ScrubRun, dir: -1 | 1, now: number): { run: ScrubRun; apply: boolean } {
  const same = run.dir === dir && now - run.at >= 0 && now - run.at <= SCRUB_RUN_MS;
  if (!same) return { run: { dir, start: now, at: now, applied: now }, apply: true };
  const apply = now - run.applied >= SCRUB_MIN_GAP_MS;
  return { run: { dir, start: run.start, at: now, applied: apply ? now : run.applied }, apply };
}

/** The new scrub target: one step of the run from `from`, inside the video. */
export function scrubTarget(from: number, run: ScrubRun, duration: number): number {
  const to = from + run.dir * scrubStep(run.at - run.start);
  return Math.min(Math.max(0, to), duration > 0 ? duration : to);
}
