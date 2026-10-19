/**
 * A small simulator for the together tests: one virtual clock with timers,
 * players that start late like a real player, and links with a delay.
 */
import type { PlayerPort, Timers } from '../player-port';

interface Task {
  at: number;
  seq: number;
  fn: () => void;
  every: number | null;
  id: number;
}

export class VirtualClock implements Timers {
  t = 0;
  private tasks: Task[] = [];
  private seq = 0;
  private nextId = 1;

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.push({ at: this.t + Math.max(0, ms), seq: this.seq++, fn, every: null, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((x) => x.id !== handle);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.push({ at: this.t + ms, seq: this.seq++, fn, every: ms, id });
    return id;
  }
  clearInterval(handle: unknown): void {
    this.clearTimeout(handle);
  }

  /** Runs time forward, firing timers in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.tasks.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.tasks[0];
      if (!next || next.at > end) break;
      this.t = next.at;
      if (next.every !== null) next.at += next.every;
      else this.tasks.shift();
      next.fn();
    }
    this.t = end;
  }
}

/** A player whose play() takes `startLatency` ms to start moving, like AVPlayer. */
export class FakePlayer implements PlayerPort {
  private base = 0;
  private since = 0;
  private moving = false;
  private wantPlay = false;
  private rate = 1;
  private buffering = false;
  private listeners = new Set<(b: boolean) => void>();
  seeks = 0;
  rates: number[] = [];

  constructor(
    private readonly clock: VirtualClock,
    public startLatency = 0,
    /** Real playback speed relative to the set rate (a slightly fast clock). */
    public speedError = 0,
  ) {}

  private settle() {
    if (this.moving) this.base += ((this.clock.t - this.since) / 1000) * this.rate * (1 + this.speedError);
    this.since = this.clock.t;
  }

  position(): number {
    this.settle();
    return this.base;
  }
  isPlaying(): boolean {
    return this.wantPlay;
  }
  isBuffering(): boolean {
    return this.buffering;
  }
  play(): void {
    if (this.wantPlay) return;
    this.wantPlay = true;
    const go = () => {
      if (!this.wantPlay) return;
      this.settle();
      this.moving = !this.buffering;
    };
    if (this.startLatency > 0) this.clock.setTimeout(go, this.startLatency);
    else go();
  }
  pause(): void {
    this.settle();
    this.wantPlay = false;
    this.moving = false;
  }
  seek(seconds: number): void {
    this.settle();
    this.base = Math.max(0, seconds);
    this.seeks += 1;
  }
  setRate(rate: number): void {
    this.settle();
    this.rate = rate;
    this.rates.push(rate);
  }
  setBuffering(b: boolean): void {
    this.settle();
    this.buffering = b;
    this.moving = this.wantPlay && !b;
    this.listeners.forEach((l) => l(b));
  }
  onBuffering(listener: (b: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Delivers `fn` after `delay` ms on the clock. */
export function deliver(clock: VirtualClock, delay: number, fn: () => void): void {
  clock.setTimeout(fn, delay);
}
