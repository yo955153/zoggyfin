import { ClockSync, isoToMs, measure, median } from '../clock';
import { DriftCorrector, positionAt, reanchor, SEEK_ONLY_DRIFT } from '../drift';

describe('measure', () => {
  it('finds the offset and round trip on a symmetric path', () => {
    // Remote clock is 500 ms ahead; 20 ms each way; 2 ms processing.
    const t0 = 1000;
    const t1 = t0 + 20 + 500;
    const t2 = t1 + 2;
    const t3 = t2 - 500 + 20;
    expect(measure({ t0, t1, t2, t3 })).toEqual({ offset: 500, rtt: 40 });
  });

  it('has an error of half the asymmetry', () => {
    // 10 ms out, 50 ms back: the error is (10 - 50) / 2 = -20 ms.
    const m = measure({ t0: 0, t1: 10, t2: 10, t3: 60 });
    expect(m.offset).toBe(-20);
    expect(m.rtt).toBe(60);
  });
});

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

describe('ClockSync', () => {
  it('prefers the samples with the lowest round trip', () => {
    const c = new ClockSync();
    // True offset 100. Fast samples are exact; slow ones have asymmetric delay.
    for (let i = 0; i < 4; i++) c.add({ t0: i * 100, t1: i * 100 + 5 + 100, t2: i * 100 + 5 + 100, t3: i * 100 + 10 });
    for (let i = 0; i < 4; i++) c.add({ t0: i * 100, t1: i * 100 + 5 + 100, t2: i * 100 + 5 + 100, t3: i * 100 + 205 });
    const e = c.estimate()!;
    expect(e.offset).toBe(100);
    expect(e.rtt).toBe(10);
    expect(e.samples).toBe(8);
  });

  it('drops impossible samples and keeps a window', () => {
    const c = new ClockSync(3);
    c.add({ t0: 10, t1: 0, t2: 0, t3: 5 }); // negative rtt
    expect(c.count).toBe(0);
    for (let i = 0; i < 5; i++) c.add({ t0: 0, t1: i, t2: i, t3: 2 });
    expect(c.count).toBe(3);
    c.reset();
    expect(c.estimate()).toBeNull();
  });

  it('parses server ISO dates', () => {
    expect(isoToMs('2026-10-19T12:00:00.250Z')).toBe(Date.UTC(2026, 9, 19, 12, 0, 0, 250));
    expect(isoToMs(null)).toBeNaN();
  });
});

describe('positionAt', () => {
  const a = { playing: true, rate: 1.5, hostTime: 1000, position: 10 };
  it('moves with the rate while playing', () => {
    expect(positionAt(a, 3000)).toBe(13);
  });
  it('stays still while paused', () => {
    expect(positionAt({ ...a, playing: false }, 9000)).toBe(10);
  });
  it('re-anchors without a jump', () => {
    const b = reanchor(a, 5000);
    expect(b.hostTime).toBe(5000);
    expect(positionAt(b, 7000)).toBe(positionAt(a, 7000));
  });
});

describe('DriftCorrector', () => {
  it('does nothing under 150 ms', () => {
    const d = new DriftCorrector();
    expect(d.decide({ expected: 10.1, actual: 10, groupRate: 1, now: 0 })).toEqual({ kind: 'none' });
  });

  it('speeds up when behind and slows down when ahead, in two steps (3 % and 6 %)', () => {
    const d = new DriftCorrector();
    expect(d.decide({ expected: 10.5, actual: 10, groupRate: 1, now: 0 })).toEqual({ kind: 'rate', rate: 1.06 });
    expect(d.decide({ expected: 10.3, actual: 10, groupRate: 1, now: 500 })).toEqual({ kind: 'rate', rate: 1.03 });
    const e = new DriftCorrector();
    expect(e.decide({ expected: 10, actual: 10.2, groupRate: 1, now: 0 })).toEqual({ kind: 'rate', rate: 0.97 });
  });

  it('scales the nudge to the group rate', () => {
    const d = new DriftCorrector();
    expect(d.decide({ expected: 10.2, actual: 10, groupRate: 2, now: 0 })).toEqual({ kind: 'rate', rate: 2.06 });
  });

  it('keeps nudging until the drift passes zero by 10 ms, then restores the rate', () => {
    const d = new DriftCorrector();
    d.decide({ expected: 10.3, actual: 10, groupRate: 1, now: 0 });
    expect(d.isNudging).toBe(true);
    expect(d.decide({ expected: 10.1, actual: 10, groupRate: 1, now: 500 })).toEqual({ kind: 'rate', rate: 1.03 });
    expect(d.decide({ expected: 10, actual: 10.005, groupRate: 1, now: 750 })).toEqual({ kind: 'rate', rate: 1.03 });
    expect(d.decide({ expected: 10, actual: 10.02, groupRate: 1, now: 1000 })).toEqual({ kind: 'rate', rate: 1 });
    expect(d.isNudging).toBe(false);
    expect(d.decide({ expected: 10.02, actual: 10, groupRate: 1, now: 30_000 })).toEqual({ kind: 'none' });
  });

  it('seeks above 1 s with a lead, then waits for the cooldown', () => {
    const d = new DriftCorrector();
    expect(d.decide({ expected: 20, actual: 15, groupRate: 1, now: 0 })).toEqual({ kind: 'seek', position: 20.1 });
    expect(d.decide({ expected: 22, actual: 15, groupRate: 1, now: 1000 })).toEqual({ kind: 'none' });
    expect(d.decide({ expected: 22, actual: 15, groupRate: 1, now: 1600 }).kind).toBe('seek');
  });

  it('corrects a smaller drift (50 ms) just after a start, but not later', () => {
    const d = new DriftCorrector();
    d.noteSeek(0);
    expect(d.decide({ expected: 10.1, actual: 10, groupRate: 1, now: 2000 }).kind).toBe('rate');
    const e = new DriftCorrector();
    e.noteSeek(0);
    expect(e.decide({ expected: 10.1, actual: 10, groupRate: 1, now: 20_000 })).toEqual({ kind: 'none' });
  });

  it('waits after a user seek', () => {
    const d = new DriftCorrector();
    d.noteSeek(0);
    expect(d.decide({ expected: 30, actual: 10, groupRate: 1, now: 100 })).toEqual({ kind: 'none' });
    d.reset();
    expect(d.decide({ expected: 30, actual: 10, groupRate: 1, now: 100 }).kind).toBe('seek');
  });
});

describe('DriftCorrector, seek only (web audio)', () => {
  it('never changes the rate, and seeks above the threshold with the lead', () => {
    const d = new DriftCorrector(SEEK_ONLY_DRIFT);
    expect(d.decide({ expected: 10.1, actual: 10, groupRate: 1, now: 0 })).toEqual({ kind: 'none' });
    const a = d.decide({ expected: 10.3, actual: 10, groupRate: 1, now: 0 });
    expect(a.kind).toBe('seek');
    expect(a.kind === 'seek' && a.position).toBeCloseTo(10.3 + SEEK_ONLY_DRIFT.seekLead);
  });

  it('waits for the cooldown after its seek', () => {
    const d = new DriftCorrector(SEEK_ONLY_DRIFT);
    d.decide({ expected: 10.5, actual: 10, groupRate: 1, now: 0 });
    expect(d.decide({ expected: 11.5, actual: 10, groupRate: 1, now: SEEK_ONLY_DRIFT.seekCooldown - 1 })).toEqual({ kind: 'none' });
  });

  it('learns the lead from the drift its seek leaves', () => {
    const d = new DriftCorrector(SEEK_ONLY_DRIFT);
    const start = d.seekLead;
    d.decide({ expected: 10.5, actual: 10, groupRate: 1, now: 0 });
    // The seek left the player 80 ms behind: the next lead is 80 ms longer.
    expect(d.decide({ expected: 20.08, actual: 20, groupRate: 1, now: 3000 })).toEqual({ kind: 'none' });
    expect(d.seekLead).toBeCloseTo(start + 0.08);
    // A player 200 ms ahead after the next seek: the lead gets shorter.
    d.decide({ expected: 30.5, actual: 30, groupRate: 1, now: 4000 }); // seeks
    d.decide({ expected: 40, actual: 40.2, groupRate: 1, now: 7000 }); // learns, then seeks again
    expect(d.seekLead).toBeCloseTo(start + 0.08 - 0.2);
  });

  it('keeps the learned lead inside its limits, and a user seek does not teach it', () => {
    const d = new DriftCorrector(SEEK_ONLY_DRIFT);
    d.decide({ expected: 10.5, actual: 10, groupRate: 1, now: 0 });
    d.decide({ expected: 30, actual: 20, groupRate: 1, now: 3000 });
    expect(d.seekLead).toBe(1.5);
    const e = new DriftCorrector(SEEK_ONLY_DRIFT);
    e.decide({ expected: 10.5, actual: 10, groupRate: 1, now: 0 });
    e.noteSeek(100);
    e.decide({ expected: 20.08, actual: 20, groupRate: 1, now: 3000 });
    expect(e.seekLead).toBe(SEEK_ONLY_DRIFT.seekLead);
  });

  it('the default corrector does not learn', () => {
    const d = new DriftCorrector();
    d.decide({ expected: 30, actual: 10, groupRate: 1, now: 0 });
    d.decide({ expected: 40.3, actual: 40, groupRate: 1, now: 3000 });
    expect(d.seekLead).toBe(0.1);
  });
});
