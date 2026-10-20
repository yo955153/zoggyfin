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
 * Under load (a host that also uploads media) the extra delay is in the
 * queues, and it is mostly one way. So the estimate uses only the samples
 * whose round trip is close to the lowest one in the window (the quiet
 * ones), and takes their median offset. A sample with a high round trip
 * never moves the offset.
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
  /** The number of samples the estimate used (the quiet ones). */
  used: number;
  /** The lowest round trip in the window, ms. */
  minRtt: number;
}

/** A sample counts as quiet when its round trip is at most the lowest one plus this, ms (or plus half the lowest, when that is more). */
export const RTT_SLACK = 5;

export class ClockSync {
  private samples: ClockMeasure[] = [];

  constructor(private readonly keep = 32) {}

  /** Adds one ping/pong. Samples with a negative or absurd round trip are dropped. Returns the measure, or null when dropped. */
  add(sample: ClockSample): ClockMeasure | null {
    const m = measure(sample);
    if (!Number.isFinite(m.offset) || !(m.rtt >= 0) || m.rtt > 10_000) return null;
    this.samples.push(m);
    if (this.samples.length > this.keep) this.samples.shift();
    return m;
  }

  get count(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }

  estimate(): ClockEstimate | null {
    if (!this.samples.length) return null;
    const minRtt = Math.min(...this.samples.map((s) => s.rtt));
    const limit = minRtt + Math.max(RTT_SLACK, minRtt / 2);
    let used = this.samples.filter((s) => s.rtt <= limit);
    // Too few quiet samples (a short window): the lowest round trips, at least 3.
    const floor = Math.min(3, this.samples.length);
    if (used.length < floor) used = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, floor);
    const offsets = used.map((s) => s.offset);
    return {
      offset: median(offsets),
      rtt: median(used.map((s) => s.rtt)),
      spread: Math.max(...offsets) - Math.min(...offsets),
      samples: this.samples.length,
      used: used.length,
      minRtt,
    };
  }
}

/** Parses an ISO date (server time) to epoch ms; NaN when it is not a date. */
export function isoToMs(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return Date.parse(iso);
}
