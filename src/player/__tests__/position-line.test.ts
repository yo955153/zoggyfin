import { PositionLine } from '../position-line';

describe('PositionLine', () => {
  it('has no position before a report', () => {
    expect(new PositionLine().at(0, 1)).toBeNull();
  });

  it('moves on from a report at the rate, at most maxAhead past the newest report', () => {
    const l = new PositionLine(2000, 1);
    l.report(10, 1000);
    expect(l.at(1250, 1)).toBeCloseTo(10.25);
    expect(l.at(1250, 2)).toBeCloseTo(10.5);
    expect(l.at(2900, 1)).toBeCloseTo(11);
  });

  it('keeps the higher prediction when a report comes late', () => {
    const l = new PositionLine();
    l.report(10, 1000);
    // A report that left at 1250 ms but came at 1430 ms: 180 ms low.
    l.report(10.25, 1430);
    expect(l.at(1500, 1)).toBeCloseTo(10.5);
  });

  it('takes a report that is ahead (one that came sooner)', () => {
    const l = new PositionLine();
    l.report(10, 1000);
    l.report(10.3, 1250);
    expect(l.at(1250, 1)).toBeCloseTo(10.3);
  });

  it('does not stop at an old report: old reports leave the window', () => {
    const l = new PositionLine(2000, 1);
    // The player runs at 0.95 of its rate: every report is a little low.
    for (let t = 0; t <= 6000; t += 250) l.report(100 + (t / 1000) * 0.95, t);
    const p = l.at(6000, 1)!;
    expect(p).toBeGreaterThan(100 + 6 * 0.95 - 0.001);
    expect(p).toBeLessThan(100 + 6 * 0.95 + 0.11);
    // And it moves on between reports.
    expect(Math.abs(l.at(6200, 1)! - p - 0.2)).toBeLessThan(0.02);
  });

  it('moves at most maxAhead past a report that stops changing (the sound plays on)', () => {
    const l = new PositionLine(2000, 1);
    for (let t = 0; t <= 600; t += 200) l.report(10 + t / 1000, t);
    // time-pos stops for a moment: the position moves on from the last good reports.
    for (let t = 800; t <= 1200; t += 200) l.report(10.6, t);
    expect(l.at(1200, 1)).toBeCloseTo(11.2);
    // It never runs more than maxAhead past the newest report.
    for (let t = 1400; t <= 5000; t += 200) l.report(10.6, t);
    expect(l.at(5000, 1)).toBeCloseTo(11.6);
  });

  it('keeps the position across a rate change, and forgets it on reset', () => {
    const l = new PositionLine();
    l.report(10, 1000);
    l.rerate(1500, 1);
    expect(l.at(2000, 2)).toBeCloseTo(11.5);
    l.reset();
    expect(l.at(2000, 1)).toBeNull();
  });
});
