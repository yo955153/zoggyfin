/**
 * Keeps a player on a group anchor: starts at a planned moment, pauses,
 * seeks after a jump, and corrects drift (`drift.ts`). Both modes use it:
 * the nearby follower (host clock) and SyncPlay (server clock).
 */
import { DEFAULT_DRIFT, DriftCorrector, type DriftOptions, positionAt } from './drift';
import type { Anchor } from './protocol';
import type { PlayerPort, Timers } from './player-port';

export interface SyncSample {
  /** Local clock ms. */
  at: number;
  expected: number;
  actual: number;
  /** expected - actual, seconds. */
  drift: number;
  rate: number;
  action: 'none' | 'rate' | 'seek' | 'start' | 'pause';
}

export interface AnchorFollowerDeps {
  /** Local clock, ms. */
  now(): number;
  /** The anchor's clock now (host or server), or null before the clock is known. */
  remoteNow(): number | null;
  timers: Timers;
  onSample?(sample: SyncSample): void;
}

export class AnchorFollower {
  private corrector: DriftCorrector;
  private anchor: Anchor | null = null;
  private player: PlayerPort | null = null;
  private startTimer: unknown = null;
  private appliedRate = 1;
  lastDrift: number | null = null;
  readonly corrections = { rate: 0, seek: 0 };

  constructor(
    private readonly deps: AnchorFollowerDeps,
    drift: DriftOptions = DEFAULT_DRIFT,
  ) {
    this.corrector = new DriftCorrector(drift);
  }

  get current(): Anchor | null {
    return this.anchor;
  }

  attach(player: PlayerPort): void {
    this.player = player;
    this.appliedRate = this.anchor?.rate ?? 1;
    this.follow(true);
  }

  detach(): void {
    this.cancelStart();
    this.player = null;
  }

  /** A new group state. Jumps (play/pause, rate, a position change) apply at once. */
  setAnchor(anchor: Anchor): void {
    const prev = this.anchor;
    this.anchor = anchor;
    const jumped =
      !prev || prev.playing !== anchor.playing || prev.rate !== anchor.rate || Math.abs(positionAt(prev, anchor.hostTime) - anchor.position) > 0.5;
    if (jumped) this.cancelStart();
    this.follow(jumped);
  }

  /** Call often (every 500 ms): corrects drift. `hard` re-applies the state. */
  follow(hard = false): void {
    const p = this.player;
    const a = this.anchor;
    const remoteNow = this.deps.remoteNow();
    if (!p || !a || remoteNow === null) return;
    const now = this.deps.now();
    if (!a.playing) {
      this.cancelStart();
      if (p.isPlaying()) p.pause();
      this.setRate(a.rate);
      if (Math.abs(p.position() - a.position) > 0.25) {
        p.seek(a.position);
        this.corrector.noteSeek(now);
      }
      if (hard) this.sample(a.position, p.position(), 'pause');
      return;
    }
    if (this.startTimer !== null) return;
    const wait = a.hostTime - remoteNow;
    if (wait > 15) {
      // A planned start: be at the start position and play at that moment.
      if (p.isPlaying()) p.pause();
      p.seek(a.position);
      this.setRate(a.rate);
      this.corrector.noteSeek(now);
      this.startTimer = this.deps.timers.setTimeout(() => {
        this.startTimer = null;
        p.play();
        this.sample(a.position, p.position(), 'start');
      }, wait);
      return;
    }
    const expected = positionAt(a, remoteNow);
    if (!p.isPlaying()) {
      this.setRate(a.rate);
      if (Math.abs(p.position() - expected) > 0.1) p.seek(expected + 0.1 * a.rate);
      p.play();
      this.corrector.noteSeek(now);
      this.sample(expected, p.position(), 'start');
      return;
    }
    if (p.isBuffering()) return;
    const actual = p.position();
    const action = this.corrector.decide({ expected, actual, groupRate: a.rate, now });
    this.lastDrift = expected - actual;
    if (action.kind === 'seek') {
      this.corrections.seek += 1;
      this.setRate(a.rate);
      p.seek(action.position);
    } else if (action.kind === 'rate') {
      if (action.rate !== a.rate) this.corrections.rate += 1;
      this.setRate(action.rate);
    } else if (hard) {
      this.setRate(a.rate);
    }
    this.sample(expected, actual, action.kind);
  }

  private cancelStart(): void {
    if (this.startTimer !== null) this.deps.timers.clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private setRate(rate: number): void {
    if (Math.abs(rate - this.appliedRate) < 0.0005) return;
    this.appliedRate = rate;
    this.player?.setRate(rate);
  }

  private sample(expected: number, actual: number, action: SyncSample['action']): void {
    this.deps.onSample?.({ at: this.deps.now(), expected, actual, drift: expected - actual, rate: this.appliedRate, action });
  }
}
