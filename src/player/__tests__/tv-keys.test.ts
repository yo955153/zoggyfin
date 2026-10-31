import {
  createDoublePress,
  createTapGate,
  DOUBLE_PRESS_MS,
  liveKeyAction,
  NO_PRESS,
  NO_RUN,
  nextRun,
  playerKeyAction,
  registerPress,
  SCRUB_MIN_GAP_MS,
  SCRUB_RUN_MS,
  scrubStep,
  scrubTarget,
  stackFeedback,
  tvKeyFromEvent,
  tvKeyFromWeb,
} from '../tv-keys';

describe('double press', () => {
  it('pairs two presses of the same key inside the window', () => {
    const first = registerPress(NO_PRESS, 'left', 1000);
    expect(first.double).toBe(false);
    const second = registerPress(first.memory, 'left', 1000 + DOUBLE_PRESS_MS);
    expect(second.double).toBe(true);
  });

  it('does not pair presses that are too far apart', () => {
    const first = registerPress(NO_PRESS, 'left', 1000);
    expect(registerPress(first.memory, 'left', 1000 + DOUBLE_PRESS_MS + 1).double).toBe(false);
  });

  it('does not pair different keys', () => {
    const first = registerPress(NO_PRESS, 'left', 1000);
    const second = registerPress(first.memory, 'right', 1100);
    expect(second.double).toBe(false);
    // The Right press starts its own pair.
    expect(registerPress(second.memory, 'right', 1200).double).toBe(true);
  });

  it('uses up a pair: a third press starts a new one', () => {
    const d = createDoublePress();
    expect([d.press('left', 0), d.press('left', 100), d.press('left', 200), d.press('left', 300)]).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it('keeps a single press single', () => {
    const d = createDoublePress();
    expect(d.press('right', 0)).toBe(false);
    expect(d.press('right', 1000)).toBe(false);
  });

  it('ignores a clock that goes backwards', () => {
    const first = registerPress(NO_PRESS, 'left', 1000);
    expect(registerPress(first.memory, 'left', 900).double).toBe(false);
  });

  it('forgets the pending press on reset', () => {
    const d = createDoublePress();
    d.press('left', 0);
    d.reset();
    expect(d.press('left', 100)).toBe(false);
  });
});

describe('player key actions', () => {
  it('shows the controls on a single Left or Right', () => {
    expect(playerKeyAction('left', false)).toEqual({ type: 'wake' });
    expect(playerKeyAction('right', false)).toEqual({ type: 'wake' });
  });

  it('seeks 10 s on a double Left or Right', () => {
    expect(playerKeyAction('left', true)).toEqual({ type: 'seek', seconds: -10 });
    expect(playerKeyAction('right', true)).toEqual({ type: 'seek', seconds: 10 });
  });

  it('maps the media keys and Back', () => {
    expect(playerKeyAction('playPause', false)).toEqual({ type: 'togglePlay' });
    expect(playerKeyAction('rewind', false)).toEqual({ type: 'skip', direction: 'back' });
    expect(playerKeyAction('fastForward', false)).toEqual({ type: 'skip', direction: 'forward' });
    expect(playerKeyAction('back', false)).toEqual({ type: 'close' });
  });

  it('leaves Select to the focused control', () => {
    expect(playerKeyAction('select', false)).toEqual({ type: 'none' });
  });
});

describe('remote events', () => {
  it('counts a press on its key-up, as Android TV sends it', () => {
    expect(tvKeyFromEvent({ eventType: 'left', eventKeyAction: 1 })).toEqual({ key: 'left', phase: 'press' });
    // A key-down (only behind a feature flag) is not counted twice.
    expect(tvKeyFromEvent({ eventType: 'left', eventKeyAction: 0 })).toBeNull();
    // tvOS: one event with no action.
    expect(tvKeyFromEvent({ eventType: 'playPause' })).toEqual({ key: 'playPause', phase: 'press' });
  });

  it('reads a held key as a start and an end', () => {
    expect(tvKeyFromEvent({ eventType: 'longRight', eventKeyAction: 0 })).toEqual({ key: 'right', phase: 'holdStart' });
    expect(tvKeyFromEvent({ eventType: 'longRight', eventKeyAction: 1 })).toEqual({ key: 'right', phase: 'holdEnd' });
  });

  it('ignores events the player does not use', () => {
    expect(tvKeyFromEvent({ eventType: 'focus', eventKeyAction: -1 })).toBeNull();
    expect(tvKeyFromEvent({ eventType: 'blur' })).toBeNull();
  });

  it('maps the web preview keys', () => {
    expect(tvKeyFromWeb('ArrowLeft')).toBe('left');
    expect(tvKeyFromWeb(' ')).toBe('playPause');
    expect(tvKeyFromWeb('Escape')).toBe('back');
    expect(tvKeyFromWeb('f')).toBeNull();
  });
});

describe('seek feedback', () => {
  it('adds up presses on the same side', () => {
    const a = stackFeedback(null, 'left', -10);
    const b = stackFeedback(a, 'left', -10);
    expect(b).toMatchObject({ side: 'left', seconds: 20 });
    expect(b.key).toBeGreaterThan(a.key);
  });

  it('starts again on the other side', () => {
    const a = stackFeedback(stackFeedback(null, 'left', -10), 'left', -10);
    expect(stackFeedback(a, 'right', 10)).toMatchObject({ side: 'right', seconds: 10 });
  });
});

describe('scrubbing with the remote', () => {
  /** Holds a key: a repeat every `every` ms for `ms`; returns the steps that moved the target. */
  function hold(ms: number, every: number): { t: number; step: number }[] {
    let run = NO_RUN;
    const steps: { t: number; step: number }[] = [];
    for (let t = 0; t <= ms; t += every) {
      const r = nextRun(run, 1, t);
      run = r.run;
      if (r.apply) steps.push({ t, step: scrubStep(run.at - run.start) });
    }
    return steps;
  }

  it('moves a single tap exactly 10 s', () => {
    const r = nextRun(NO_RUN, 1, 1000);
    expect(r.apply).toBe(true);
    expect(scrubTarget(100, r.run, 1000)).toBe(110);
  });

  it('keeps 10 s steps for 1.5 s of hold, then 30 s, and 60 s only after 4 s', () => {
    const steps = hold(5000, 50);
    const stepAt = (ms: number) => [...steps].reverse().find((x) => x.t <= ms)?.step;
    expect(steps.filter((x) => x.t < 1500).every((x) => x.step === 10)).toBe(true);
    expect(stepAt(2000)).toBe(30);
    expect(stepAt(3900)).toBe(30);
    expect(stepAt(5000)).toBe(60);
    // Steps are at least SCRUB_MIN_GAP_MS apart.
    expect(steps.every((x, i) => i === 0 || x.t - (steps[i - 1]?.t ?? 0) >= SCRUB_MIN_GAP_MS)).toBe(true);
  });

  it('applies at most about 7 steps a second, however fast the remote repeats', () => {
    expect(hold(1000, 20).length).toBeLessThanOrEqual(8);
    expect(hold(1000, 20).length).toBeGreaterThanOrEqual(6);
  });

  it('starts a new run after a pause or a change of direction', () => {
    const a = nextRun(nextRun(NO_RUN, 1, 0).run, 1, 300).run;
    expect(a.start).toBe(0);
    expect(nextRun(a, 1, 300 + SCRUB_RUN_MS + 1).run.start).toBe(300 + SCRUB_RUN_MS + 1);
    expect(nextRun(a, -1, 350).run).toMatchObject({ dir: -1, start: 350 });
  });

  it('keeps the target inside the video', () => {
    const tap = (dir: -1 | 1) => ({ dir, start: 0, at: 0, applied: 0 });
    expect(scrubTarget(5, tap(-1), 100)).toBe(0);
    expect(scrubTarget(95, tap(1), 100)).toBe(100);
    expect(scrubTarget(50, tap(1), 100)).toBe(60);
  });
});

describe('tap gate (controls hidden)', () => {
  it('waits on a single press, then shows the controls after the window', () => {
    const g = createTapGate();
    expect(g.press('right', 1000, true)).toEqual({ double: false, wait: true });
    expect(g.due(1000 + DOUBLE_PRESS_MS - 1)).toBe(false);
    expect(g.due(1000 + DOUBLE_PRESS_MS)).toBe(true);
    expect(g.due(1000 + DOUBLE_PRESS_MS + 50)).toBe(false);
  });

  it('a second press in the window seeks and never shows the controls', () => {
    const g = createTapGate();
    g.press('left', 1000, true);
    expect(g.press('left', 1300, true)).toEqual({ double: true, wait: false });
    expect(g.due(5000)).toBe(false);
  });

  it('repeated pairs keep seeking with the controls hidden', () => {
    const g = createTapGate();
    const t = [0, 200, 500, 700, 1000, 1200];
    const doubles = t.map((at) => g.press('right', at, true).double);
    expect(doubles).toEqual([false, true, false, true, false, true]);
    expect(g.due(9999)).toBe(false);
  });

  it('a late second press is a new single press', () => {
    const g = createTapGate();
    g.press('right', 0, true);
    expect(g.due(DOUBLE_PRESS_MS)).toBe(true);
    // The controls are shown now: the late press does not pair and does not wait.
    expect(g.press('right', DOUBLE_PRESS_MS + 10, false)).toEqual({ double: false, wait: false });
  });

  it('the other direction does not pair and waits again', () => {
    const g = createTapGate();
    g.press('left', 0, true);
    expect(g.press('right', 100, true)).toEqual({ double: false, wait: true });
    expect(g.due(100 + DOUBLE_PRESS_MS)).toBe(true);
  });

  it('with the controls shown, presses pair and never wait', () => {
    const g = createTapGate();
    expect(g.press('left', 0, false)).toEqual({ double: false, wait: false });
    expect(g.press('left', 300, false)).toEqual({ double: true, wait: false });
    expect(g.due(9999)).toBe(false);
  });

  it('cancel forgets the waiting press and the pair', () => {
    const g = createTapGate();
    g.press('left', 0, true);
    g.cancel();
    expect(g.due(9999)).toBe(false);
    expect(g.press('left', 100, true).double).toBe(false);
  });
});

describe('live TV keys', () => {
  it('zaps with the channel keys at any time', () => {
    expect(liveKeyAction('channelUp', false)).toEqual({ type: 'zap', delta: 1 });
    expect(liveKeyAction('channelDown', true)).toEqual({ type: 'zap', delta: -1 });
    expect(tvKeyFromEvent({ eventType: 'channelUp', eventKeyAction: 1 })).toEqual({ key: 'channelUp', phase: 'press' });
    expect(tvKeyFromEvent({ eventType: 'next', eventKeyAction: 1 })).toEqual({ key: 'channelUp', phase: 'press' });
    expect(tvKeyFromWeb('PageDown')).toBe('channelDown');
  });

  it('zaps with Up and Down only while the controls are hidden', () => {
    expect(liveKeyAction('up', true)).toEqual({ type: 'zap', delta: 1 });
    expect(liveKeyAction('down', true)).toEqual({ type: 'zap', delta: -1 });
    expect(liveKeyAction('up', false)).toBeNull();
    expect(liveKeyAction('down', false)).toBeNull();
  });

  it('never seeks: Left, Right, rewind and fast forward only show the controls', () => {
    for (const k of ['left', 'right', 'rewind', 'fastForward'] as const) expect(liveKeyAction(k, true)).toEqual({ type: 'wake' });
    expect(liveKeyAction('back', true)).toBeNull();
    expect(liveKeyAction('playPause', true)).toBeNull();
  });

  it('leaves video keys as they were', () => {
    expect(playerKeyAction('channelUp', false)).toEqual({ type: 'none' });
    expect(playerKeyAction('down', false)).toEqual({ type: 'wake' });
  });
});
