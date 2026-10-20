/**
 * A position that moves on between reports, for a player that reports its
 * position late by a different time each time (libmpv's `time-pos` goes
 * through the Tauri bridge). A late report can only show a position that is
 * too low, so the position is the highest prediction from the reports of the
 * last `window` ms. An old report leaves the window, so a player that runs a
 * little slower than its rate, or stops, pulls the position down within that
 * time. Watch together compares positions to the millisecond, so a plain
 * "last report" is too noisy.
 */
export class PositionLine {
  private reports: { pos: number; at: number }[] = [];

  constructor(
    /** ms: how long a report counts. */
    private readonly window = 2000,
    /** Seconds the position may move past the newest report. */
    private readonly maxAhead = 1,
  ) {}

  /** Forget the reports (a seek, a pause, a load, a stall). */
  reset(): void {
    this.reports = [];
  }

  /** A report: `pos` seconds at `at` (ms). */
  report(pos: number, at: number): void {
    this.reports.push({ pos, at });
    this.reports = this.reports.filter((r) => at - r.at <= this.window);
  }

  /** The position at `now` (ms) while the player plays at `rate`, or null with no report. */
  at(now: number, rate: number): number | null {
    const newest = this.reports[this.reports.length - 1];
    if (!newest) return null;
    let best = -Infinity;
    for (const r of this.reports) {
      if (now - r.at > this.window) continue;
      best = Math.max(best, r.pos + ((now - r.at) / 1000) * rate);
    }
    if (best === -Infinity) best = newest.pos;
    return Math.min(Math.max(best, newest.pos), newest.pos + this.maxAhead * Math.max(rate, 1));
  }

  /** The rate changes at `now`: keep the position now as the only report. */
  rerate(now: number, oldRate: number): void {
    const p = this.at(now, oldRate);
    this.reports = p === null ? [] : [{ pos: p, at: now }];
  }
}
