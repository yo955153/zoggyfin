/**
 * Drift correction. Each follower compares its player position with the
 * position the group expects and decides:
 *
 * - drift under `rateAbove` (150 ms): nothing (or back to the group rate
 *   once a nudge brought the drift under `settleBelow`);
 * - drift from `rateAbove` to `seekAbove` (1 s): a small rate change that
 *   closes the gap in about `window` seconds, at most `maxNudge` (8 %);
 * - drift above `seekAbove`: a seek to the expected position plus a small
 *   lead for the time the seek takes.
 *
 * After a seek the corrector waits `seekCooldown` before it decides again,
 * because the player reports old positions while it seeks.
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
  settleBelow: number;
  seekAbove: number;
  /** Seconds in which a rate nudge should close the gap. */
  window: number;
  maxNudge: number;
  /** Seconds added to a seek target. */
  seekLead: number;
  /** ms after a seek with no decisions. */
  seekCooldown: number;
}

export const DEFAULT_DRIFT: DriftOptions = {
  rateAbove: 0.15,
  settleBelow: 0.04,
  seekAbove: 1,
  window: 4,
  maxNudge: 0.08,
  seekLead: 0.1,
  seekCooldown: 1500,
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
    if (size > o.seekAbove) {
      this.seekAt = now;
      this.nudging = false;
      return { kind: 'seek', position: Math.max(0, expected + o.seekLead * groupRate) };
    }
    if (size > o.rateAbove || (this.nudging && size > o.settleBelow)) {
      this.nudging = true;
      const nudge = Math.max(-o.maxNudge, Math.min(o.maxNudge, drift / o.window));
      return { kind: 'rate', rate: round3(groupRate * (1 + nudge)) };
    }
    if (this.nudging) {
      this.nudging = false;
      return { kind: 'rate', rate: groupRate };
    }
    return { kind: 'none' };
  }
}
