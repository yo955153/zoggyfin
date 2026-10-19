import {
  dueForRetry,
  etaSeconds,
  fraction,
  MAX_AUTO_RETRIES,
  pickToStart,
  reorder,
  retryDelayMs,
  transition,
} from '../state-machine';
import { rec } from '../test-utils/fixtures';

describe('transition', () => {
  it('runs the happy path: queued, downloading, completed', () => {
    let r = rec();
    r = transition(r, { type: 'start', now: 0 });
    expect(r.state).toBe('downloading');
    r = transition(r, { type: 'progress', bytesDone: 500, bytesTotal: 1000, now: 1000 });
    expect(r.bytesDone).toBe(500);
    expect(r.bytesTotal).toBe(1000);
    expect(r.speed).toBe(500);
    r = transition(r, { type: 'complete', bytes: 1000, now: 2000 });
    expect(r.state).toBe('completed');
    expect(r.bytesDone).toBe(1000);
    expect(r.completedAt).toBe(2000);
  });

  it('smooths the speed over samples', () => {
    let r = transition(rec(), { type: 'start', now: 0 });
    r = transition(r, { type: 'progress', bytesDone: 1000, bytesTotal: 10_000, now: 1000 });
    r = transition(r, { type: 'progress', bytesDone: 4000, bytesTotal: 10_000, now: 2000 });
    expect(r.speed).toBeCloseTo(1000 * 0.7 + 3000 * 0.3);
  });

  it('keeps a known total when the server sends none', () => {
    let r = transition(rec({ bytesTotal: 900 }), { type: 'start', now: 0 });
    r = transition(r, { type: 'progress', bytesDone: 100, bytesTotal: null, now: 500 });
    expect(r.bytesTotal).toBe(900);
  });

  it('ignores events that do not apply (returns the same object)', () => {
    const queued = rec();
    expect(transition(queued, { type: 'progress', bytesDone: 1, bytesTotal: 2, now: 1 })).toBe(queued);
    expect(transition(queued, { type: 'resume' })).toBe(queued);
    expect(transition(queued, { type: 'retry' })).toBe(queued);
    const done = rec({ state: 'completed' });
    expect(transition(done, { type: 'cancel' })).toBe(done);
    expect(transition(done, { type: 'pause' })).toBe(done);
    expect(transition(done, { type: 'start', now: 1 })).toBe(done);
  });

  it('pauses and resumes back into the queue', () => {
    const r = transition(rec(), { type: 'start', now: 0 });
    const paused = transition(r, { type: 'pause' });
    expect(paused.state).toBe('paused');
    expect(paused.speed).toBe(0);
    expect(transition(paused, { type: 'resume' }).state).toBe('queued');
    expect(transition(rec(), { type: 'pause' }).state).toBe('paused');
  });

  it('fails with a growing backoff, then waits for the user', () => {
    let r = rec();
    for (let i = 1; i <= MAX_AUTO_RETRIES; i++) {
      r = transition(transition(r, { type: 'start', now: 0 }), { type: 'fail', error: 'lost', now: 10_000 });
      expect(r.state).toBe('failed');
      expect(r.attempts).toBe(i);
      expect(r.retryAt).toBe(10_000 + retryDelayMs(i));
      r = transition(r, { type: 'autoRetry', now: r.retryAt as number });
      expect(r.state).toBe('queued');
    }
    r = transition(transition(r, { type: 'start', now: 0 }), { type: 'fail', error: 'lost', now: 10_000 });
    expect(r.retryAt).toBeNull();
    expect(transition(r, { type: 'autoRetry', now: Number.MAX_SAFE_INTEGER })).toBe(r);
    const manual = transition(r, { type: 'retry' });
    expect(manual.state).toBe('queued');
    expect(manual.attempts).toBe(0);
    expect(manual.error).toBeNull();
  });

  it('does not retry before the backoff ends', () => {
    const failed = rec({ state: 'failed', retryAt: 5000, attempts: 1 });
    expect(transition(failed, { type: 'autoRetry', now: 4999 })).toBe(failed);
  });

  it('cancels anything that is not completed', () => {
    for (const state of ['queued', 'downloading', 'paused', 'failed'] as const) {
      expect(transition(rec({ state }), { type: 'cancel' }).state).toBe('cancelled');
    }
  });

  it('completes a task that finished while the app was closed (still queued)', () => {
    expect(transition(rec(), { type: 'complete', bytes: 10, now: 1 }).state).toBe('completed');
  });
});

describe('retryDelayMs', () => {
  it('grows four times each attempt, up to 30 minutes', () => {
    expect(retryDelayMs(1)).toBe(15_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(10)).toBe(30 * 60_000);
  });
});

describe('pickToStart', () => {
  it('fills free slots in queue order', () => {
    const list = [
      rec({ itemId: 'a', order: 3 }),
      rec({ itemId: 'b', order: 1 }),
      rec({ itemId: 'c', order: 2 }),
      rec({ itemId: 'd', state: 'paused', order: 0 }),
    ];
    expect(pickToStart(list, 2).map((r) => r.itemId)).toEqual(['b', 'c']);
  });

  it('respects the running downloads', () => {
    const list = [rec({ itemId: 'x', state: 'downloading' }), rec({ itemId: 'a', order: 1 }), rec({ itemId: 'b', order: 2 })];
    expect(pickToStart(list, 2).map((r) => r.itemId)).toEqual(['a']);
    expect(pickToStart([...list, rec({ itemId: 'y', state: 'downloading' })], 2)).toEqual([]);
  });
});

describe('helpers', () => {
  it('finds failed records due for a retry', () => {
    const list = [rec({ itemId: 'a', state: 'failed', retryAt: 10 }), rec({ itemId: 'b', state: 'failed', retryAt: null }), rec({ itemId: 'c', state: 'failed', retryAt: 99 })];
    expect(dueForRetry(list, 50).map((r) => r.itemId)).toEqual(['a']);
  });

  it('computes the fraction and the time left', () => {
    expect(fraction(rec({ bytesDone: 25, bytesTotal: 100 }))).toBe(0.25);
    expect(fraction(rec({ bytesDone: 25, bytesTotal: null }))).toBe(0);
    expect(fraction(rec({ state: 'completed' }))).toBe(1);
    expect(etaSeconds({ bytesDone: 50, bytesTotal: 150, speed: 10 })).toBe(10);
    expect(etaSeconds({ bytesDone: 50, bytesTotal: 150, speed: 0 })).toBeNull();
  });

  it('reorders the active queue', () => {
    const list = [rec({ itemId: 'a', order: 0 }), rec({ itemId: 'b', order: 1 }), rec({ itemId: 'c', order: 2 }), rec({ itemId: 'z', state: 'completed', order: 9 })];
    expect(reorder(list, 'c', 0)).toEqual({ c: 0, a: 1, b: 2 });
    expect(reorder(list, 'a', 5)).toEqual({ b: 0, c: 1, a: 2 });
    expect(reorder(list, 'missing', 0)).toEqual({});
  });
});
