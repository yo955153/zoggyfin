/**
 * Live TV zapping with the remote (TiviMate style). Up, Down and the channel
 * keys step through the channels in the zap banner; the player tunes only
 * when the presses stop for ZAP_TUNE_MS, so five quick presses open one
 * stream, not five (providers often allow one connection). Select tunes at
 * once, Back drops the choice. After a tune the banner stays ZAP_BANNER_MS.
 *
 * The banner never opens a second stream to preview a channel: it shows the
 * guide's now and next only.
 *
 * Pure, so it is unit-tested: the caller owns the timer (`zapDeadline`) and
 * tunes when an event returns `tune`. An event that does not apply returns
 * the same state object.
 */

/** The player tunes this long after the last step (ms). */
export const ZAP_TUNE_MS = 700;

/** The banner stays this long after a tune (ms). */
export const ZAP_BANNER_MS = 3000;

export type ZapState =
  /** No banner. */
  | { phase: 'idle' }
  /** The banner shows `index`; the player still plays the channel it played. */
  | { phase: 'choosing'; index: number; at: number }
  /** The banner shows the channel that now plays; it hides at `at + ZAP_BANNER_MS`. */
  | { phase: 'shown'; index: number; at: number };

export const ZAP_IDLE: ZapState = { phase: 'idle' };

export type ZapEvent =
  /** A step of one channel. `current` is the channel that plays; `count` the length of the list. */
  | { type: 'step'; delta: 1 | -1; current: number; count: number; now: number }
  /** Select: tune to the chosen channel at once. */
  | { type: 'select'; current: number; now: number }
  /** Back: drop the choice and hide the banner. */
  | { type: 'back' }
  /** The timer from `zapDeadline` fired. */
  | { type: 'tick'; current: number; now: number }
  /** A tune from elsewhere (the channel list, a button): show the banner for it. */
  | { type: 'tuned'; current: number; now: number };

export interface ZapResult {
  state: ZapState;
  /** The channel to tune to now, or null. */
  tune: number | null;
}

function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function commit(state: ZapState & { phase: 'choosing' }, current: number, now: number): ZapResult {
  return { state: { phase: 'shown', index: state.index, at: now }, tune: state.index === current ? null : state.index };
}

export function zapReducer(state: ZapState, e: ZapEvent): ZapResult {
  switch (e.type) {
    case 'step': {
      if (e.count < 2) return { state, tune: null };
      const from = state.phase === 'choosing' ? state.index : e.current;
      return { state: { phase: 'choosing', index: wrap(from + e.delta, e.count), at: e.now }, tune: null };
    }
    case 'select':
      return state.phase === 'choosing' ? commit(state, e.current, e.now) : { state, tune: null };
    case 'back':
      return state.phase === 'choosing' ? { state: ZAP_IDLE, tune: null } : { state, tune: null };
    case 'tick':
      if (state.phase === 'choosing' && e.now - state.at >= ZAP_TUNE_MS) return commit(state, e.current, e.now);
      if (state.phase === 'shown' && e.now - state.at >= ZAP_BANNER_MS) return { state: ZAP_IDLE, tune: null };
      return { state, tune: null };
    case 'tuned':
      return { state: { phase: 'shown', index: e.current, at: e.now }, tune: null };
  }
}

/** When the caller must send the next `tick` (ms since the epoch), or null for no timer. */
export function zapDeadline(state: ZapState): number | null {
  if (state.phase === 'choosing') return state.at + ZAP_TUNE_MS;
  if (state.phase === 'shown') return state.at + ZAP_BANNER_MS;
  return null;
}

/** True while Back belongs to the banner (it drops the choice instead of leaving the player). */
export function zapTakesBack(state: ZapState): boolean {
  return state.phase === 'choosing';
}

