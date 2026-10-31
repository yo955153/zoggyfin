import { ZAP_BANNER_MS, ZAP_IDLE, ZAP_TUNE_MS, zapDeadline, zapReducer, type ZapState, zapTakesBack } from '../zap';

const step = (state: ZapState, delta: 1 | -1, now: number, current = 5, count = 10) => zapReducer(state, { type: 'step', delta, current, count, now });

describe('zap banner', () => {
  it('steps from the channel that plays and tunes once the presses stop', () => {
    let r = step(ZAP_IDLE, 1, 1000);
    expect(r).toEqual({ state: { phase: 'choosing', index: 6, at: 1000 }, tune: null });
    r = step(r.state, 1, 1200);
    r = step(r.state, 1, 1400);
    expect(r.state).toEqual({ phase: 'choosing', index: 8, at: 1400 });
    expect(zapDeadline(r.state)).toBe(1400 + ZAP_TUNE_MS);
    // Too soon: nothing happens, and the same object comes back.
    const early = zapReducer(r.state, { type: 'tick', current: 5, now: 1400 + ZAP_TUNE_MS - 1 });
    expect(early.state).toBe(r.state);
    expect(early.tune).toBeNull();
    const tuned = zapReducer(r.state, { type: 'tick', current: 5, now: 1400 + ZAP_TUNE_MS });
    expect(tuned).toEqual({ state: { phase: 'shown', index: 8, at: 1400 + ZAP_TUNE_MS }, tune: 8 });
  });

  it('waits between 600 and 800 ms before it tunes', () => {
    expect(ZAP_TUNE_MS).toBeGreaterThanOrEqual(600);
    expect(ZAP_TUNE_MS).toBeLessThanOrEqual(800);
  });

  it('wraps round the ends of the list', () => {
    expect(step(ZAP_IDLE, 1, 0, 9, 10).state).toMatchObject({ index: 0 });
    expect(step(ZAP_IDLE, -1, 0, 0, 10).state).toMatchObject({ index: 9 });
  });

  it('does nothing with fewer than two channels', () => {
    const r = step(ZAP_IDLE, 1, 0, 0, 1);
    expect(r.state).toBe(ZAP_IDLE);
    expect(r.tune).toBeNull();
  });

  it('tunes at once on Select', () => {
    const r = step(ZAP_IDLE, -1, 1000);
    expect(zapReducer(r.state, { type: 'select', current: 5, now: 1100 })).toEqual({ state: { phase: 'shown', index: 4, at: 1100 }, tune: 4 });
  });

  it('does not tune again when the choice is back on the channel that plays', () => {
    let r = step(ZAP_IDLE, 1, 1000);
    r = step(r.state, -1, 1100);
    const t = zapReducer(r.state, { type: 'tick', current: 5, now: 1100 + ZAP_TUNE_MS });
    expect(t.tune).toBeNull();
    expect(t.state).toMatchObject({ phase: 'shown', index: 5 });
  });

  it('drops the choice on Back, and Back belongs to the banner only while choosing', () => {
    const r = step(ZAP_IDLE, 1, 1000);
    expect(zapTakesBack(r.state)).toBe(true);
    expect(zapReducer(r.state, { type: 'back' })).toEqual({ state: ZAP_IDLE, tune: null });
    const shown: ZapState = { phase: 'shown', index: 5, at: 0 };
    expect(zapTakesBack(shown)).toBe(false);
    expect(zapReducer(shown, { type: 'back' }).state).toBe(shown);
    expect(zapTakesBack(ZAP_IDLE)).toBe(false);
  });

  it('keeps the banner a while after a tune, then hides it', () => {
    const shown = zapReducer(ZAP_IDLE, { type: 'tuned', current: 3, now: 5000 }).state;
    expect(shown).toEqual({ phase: 'shown', index: 3, at: 5000 });
    expect(zapDeadline(shown)).toBe(5000 + ZAP_BANNER_MS);
    expect(zapReducer(shown, { type: 'tick', current: 3, now: 5000 + ZAP_BANNER_MS - 1 }).state).toBe(shown);
    expect(zapReducer(shown, { type: 'tick', current: 3, now: 5000 + ZAP_BANNER_MS }).state).toBe(ZAP_IDLE);
    expect(zapDeadline(ZAP_IDLE)).toBeNull();
  });

  it('steps on from a shown banner from the channel that plays', () => {
    const shown: ZapState = { phase: 'shown', index: 5, at: 0 };
    expect(step(shown, 1, 100).state).toEqual({ phase: 'choosing', index: 6, at: 100 });
  });

  it('ignores Select and the timer with no banner', () => {
    expect(zapReducer(ZAP_IDLE, { type: 'select', current: 1, now: 0 }).state).toBe(ZAP_IDLE);
    expect(zapReducer(ZAP_IDLE, { type: 'tick', current: 1, now: 99999 }).state).toBe(ZAP_IDLE);
  });
});
