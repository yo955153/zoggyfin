/**
 * Drift correction. Each follower compares its player position with the
 * position the group expects and decides:
 *
 * - drift under `rateAbove` (150 ms): nothing. A nudge goes on until the
 *   drift has passed zero by `overshoot` (10 ms), because the change back
 *   to the group rate costs AVPlayer about 20 ms (measured in the spike);
 * - drift from `rateAbove` to `seekAbove` (1 s): a small rate change of
 *   `smallNudge` (3 %), or `maxNudge` (6 %) above `bigNudgeAbove` (0.4 s).
 *   Only two steps, because each rate change makes AVPlayer stall for a
 *   moment: the spike saw a nudge that changed every 500 ms lose time;
 * - drift above `seekAbove`: a seek to the expected position plus a small
 *   lead for the time the seek takes.
 *
 * After a seek the corrector waits `seekCooldown` before it decides again,
 * because the player reports old positions while it seeks. Then, for
 * `fineWindow`, it also nudges drift above `fineAbove` (40 ms): a player
 * starts late by a steady amount (the spike measured 15–130 ms), and that
 * error would otherwise stay under 150 ms for the whole film.
 */
import type { Anchor } from './protocol';

/** The expected media position (seconds) at a time on the anchor's clock (ms). */
export function positionAt(anchor: Anchor, time: number): number {
  if (!anchor.playing) return anchor.position;
  return Math.max(0, anchor.position + ((time - anchor.hostTime) / 1000) * anchor.rate);
}

/** A new anchor for the same state, taken at `time`. */
export function reanchor(anchor: Anchor, time: number): Anchor {
  return { ...anchor, hostTime: time, position: positionAt(anchor, time) };
}

export interface DriftOptions {
  rateAbove: number;
  /** Seconds past zero at which a nudge stops. */
  overshoot: number;
  seekAbove: number;
  smallNudge: number;
  maxNudge: number;
  /** Seconds of drift above which the nudge is `maxNudge`. */
  bigNudgeAbove: number;
  /** Seconds added to a seek target. */
  seekLead: number;
  /** ms after a seek with no decisions. */
  seekCooldown: number;
  /** Seconds: the lower nudge threshold just after a start or seek. */
  fineAbove: number;
  /** ms after the cooldown with the lower threshold. */
  fineWindow: number;
}

export const DEFAULT_DRIFT: DriftOptions = {
  rateAbove: 0.15,
  overshoot: 0.01,
  seekAbove: 1,
  smallNudge: 0.03,
  maxNudge: 0.06,
  bigNudgeAbove: 0.4,
  seekLead: 0.1,
  seekCooldown: 1500,
  fineAbove: 0.04,
  fineWindow: 8000,
};

export type DriftAction = { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek'; position: number };

export interface DriftInput {
  /** Expected position, seconds. */
  expected: number;
  /** Player position, seconds. */
  actual: number;
  /** The group rate. */
  groupRate: number;
  /** Local monotonic time, ms. */
  now: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Stateful because of the hysteresis (nudging until settled) and the seek cooldown. */
export class DriftCorrector {
  private nudging = false;
  /** +1 while speeding up, -1 while slowing down. */
  private direction = 0;
  private seekAt = -Infinity;

  constructor(private readonly opts: DriftOptions = DEFAULT_DRIFT) {}

  /** Call after any seek that the corrector did not ask for (a user seek). */
  noteSeek(now: number): void {
    this.seekAt = now;
    this.nudging = false;
  }

  reset(): void {
    this.nudging = false;
    this.seekAt = -Infinity;
  }

  get isNudging(): boolean {
    return this.nudging;
  }

  decide({ expected, actual, groupRate, now }: DriftInput): DriftAction {
    const o = this.opts;
    if (now - this.seekAt < o.seekCooldown) return { kind: 'none' };
    // Positive: the player is behind and must go faster.
    const drift = expected - actual;
    const size = Math.abs(drift);
    const fine = now - this.seekAt < o.seekCooldown + o.fineWindow;
    const nudgeAbove = fine ? Math.min(o.fineAbove, o.rateAbove) : o.rateAbove;
    if (size > o.seekAbove) {
      this.seekAt = now;
      this.nudging = false;
      return { kind: 'seek', position: Math.max(0, expected + o.seekLead * groupRate) };
    }
    const keepNudging = this.nudging && drift * this.direction > -o.overshoot;
    if (size > nudgeAbove || keepNudging) {
      if (!keepNudging) this.direction = Math.sign(drift);
      this.nudging = true;
      const nudge = this.direction * (size > o.bigNudgeAbove ? o.maxNudge : o.smallNudge);
      return { kind: 'rate', rate: round3(groupRate * (1 + nudge)) };
    }
    if (this.nudging) {
      this.nudging = false;
      return { kind: 'rate', rate: groupRate };
    }
    return { kind: 'none' };
  }
}
