import {
  createDoublePress,
  DOUBLE_PRESS_MS,
  NO_PRESS,
  NO_RUN,
  nextRun,
  playerKeyAction,
  registerPress,
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
  it('counts the key-down and drops the key-up', () => {
    expect(tvKeyFromEvent({ eventType: 'left', eventKeyAction: 0 })).toBe('left');
    expect(tvKeyFromEvent({ eventType: 'left', eventKeyAction: 1 })).toBeNull();
    expect(tvKeyFromEvent({ eventType: 'playPause' })).toBe('playPause');
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
  it('starts with 10 s steps and speeds up while a key is held', () => {
    let run = NO_RUN;
    const steps: number[] = [];
    for (let i = 0; i < 12; i++) {
      run = nextRun(run, 1, i * 100);
      steps.push(scrubStep(run.count));
    }
    expect(steps.slice(0, 3)).toEqual([10, 10, 10]);
    expect(steps[4]).toBe(30);
    expect(steps[11]).toBe(60);
  });

  it('starts a new run after a pause or a change of direction', () => {
    const a = nextRun(nextRun(NO_RUN, 1, 0), 1, 100);
    expect(a.count).toBe(2);
    expect(nextRun(a, 1, 100 + SCRUB_RUN_MS + 1).count).toBe(1);
    expect(nextRun(a, -1, 150)).toMatchObject({ dir: -1, count: 1 });
  });

  it('keeps the target inside the video', () => {
    expect(scrubTarget(5, { dir: -1, count: 1, at: 0 }, 100)).toBe(0);
    expect(scrubTarget(95, { dir: 1, count: 1, at: 0 }, 100)).toBe(100);
    expect(scrubTarget(50, { dir: 1, count: 1, at: 0 }, 100)).toBe(60);
  });
});
