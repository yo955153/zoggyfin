/**
 * Clock sync, NTP style. A guest sends a ping at t0 (its clock). The host
 * stamps t1 when the ping arrives and t2 when the pong leaves (host clock).
 * The guest stamps t3 when the pong arrives (its clock).
 *
 *   offset = ((t1 - t0) + (t2 - t3)) / 2   (host clock minus local clock)
 *   rtt    = (t3 - t0) - (t2 - t1)
 *
 * The same math works for the Jellyfin server clock (SyncPlay): there t1
 * and t2 are the server's request reception and response times.
 *
 * One sample has an error of up to rtt / 2 when the path is not symmetric.
 * The estimate keeps recent samples, uses the half with the lowest round
 * trip, and takes the median offset of that half.
 */

export interface ClockSample {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

export interface ClockMeasure {
  /** Remote clock minus local clock, ms. */
  offset: number;
  /** Round trip without the remote's processing time, ms. */
  rtt: number;
}

export function measure(s: ClockSample): ClockMeasure {
  return { offset: (s.t1 - s.t0 + (s.t2 - s.t3)) / 2, rtt: s.t3 - s.t0 - (s.t2 - s.t1) };
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ClockEstimate {
  offset: number;
  /** Median round trip of the samples used, ms. */
  rtt: number;
  /** Largest offset minus smallest offset of the samples used, ms. */
  spread: number;
  samples: number;
}

export class ClockSync {
  private samples: ClockMeasure[] = [];

  constructor(private readonly keep = 16) {}

  /** Adds one ping/pong. Samples with a negative or absurd round trip are dropped. */
  add(sample: ClockSample): void {
    const m = measure(sample);
    if (!Number.isFinite(m.offset) || !(m.rtt >= 0) || m.rtt > 10_000) return;
    this.samples.push(m);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get count(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }

  estimate(): ClockEstimate | null {
    if (!this.samples.length) return null;
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 2)));
    const offsets = best.map((s) => s.offset);
    return {
      offset: median(offsets),
      rtt: median(best.map((s) => s.rtt)),
      spread: Math.max(...offsets) - Math.min(...offsets),
      samples: this.samples.length,
    };
  }
}

/** Parses an ISO date (server time) to epoch ms; NaN when it is not a date. */
export function isoToMs(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return Date.parse(iso);
}
