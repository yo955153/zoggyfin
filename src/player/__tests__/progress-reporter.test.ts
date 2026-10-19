import { type PlaybackReport, type PlaybackSnapshot, ProgressReporter, type ProgressTransport, secondsToTicks, type Timer } from '../progress-reporter';

function fakeTimer() {
  let fn: (() => void) | null = null;
  let cleared = 0;
  const timer: Timer = {
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      cleared++;
      fn = null;
    },
  };
  return { timer, fire: () => fn?.(), active: () => fn !== null, cleared: () => cleared };
}

function setup(fail = false) {
  const calls: { kind: string; report: PlaybackReport; event?: string }[] = [];
  const transport: ProgressTransport = {
    start: async (report) => {
      calls.push({ kind: 'start', report });
    },
    progress: async (report, event) => {
      if (fail) throw new Error('offline');
      calls.push({ kind: 'progress', report, event });
    },
    stopped: async (report) => {
      calls.push({ kind: 'stopped', report });
    },
  };
  const snap: PlaybackSnapshot = {
    positionTicks: 0,
    isPaused: false,
    isMuted: false,
    playbackRate: 1,
    audioStreamIndex: 1,
    subtitleStreamIndex: null,
  };
  const t = fakeTimer();
  const errors: unknown[] = [];
  const r = new ProgressReporter(transport, () => snap, t.timer, 10_000, (e) => errors.push(e));
  const session = { itemId: 'i', mediaSourceId: 'm', playSessionId: 'p', playMethod: 'DirectPlay' as const, canSeek: true };
  return { r, calls, snap, t, errors, session };
}

const flush = () => new Promise((res) => setTimeout(res, 0));

describe('ProgressReporter', () => {
  it('starts, reports on the timer and stops', async () => {
    const { r, calls, snap, t, session } = setup();
    expect(r.current).toBe('idle');
    r.start(session);
    expect(r.current).toBe('active');
    snap.positionTicks = secondsToTicks(10);
    t.fire();
    snap.positionTicks = secondsToTicks(20);
    t.fire();
    await r.stop();
    expect(r.current).toBe('stopped');
    expect(calls.map((c) => c.kind)).toEqual(['start', 'progress', 'progress', 'stopped']);
    expect(calls[1]?.report.positionTicks).toBe(100_000_000);
    expect(calls[1]?.event).toBe('TimeUpdate');
    expect(calls[3]?.report).toMatchObject({ itemId: 'i', mediaSourceId: 'm', playSessionId: 'p', positionTicks: 200_000_000 });
    expect(t.active()).toBe(false);
  });

  it('reports at once on pause and seek', async () => {
    const { r, calls, snap, session } = setup();
    r.start(session);
    snap.isPaused = true;
    r.tick('Pause');
    r.tick('Seek');
    await flush();
    expect(calls.slice(1).map((c) => c.event)).toEqual(['Pause', 'Seek']);
    expect(calls[1]?.report.isPaused).toBe(true);
  });

  it('ignores ticks before start and after stop', async () => {
    const { r, calls, session } = setup();
    r.tick('Pause');
    r.start(session);
    await r.stop();
    r.tick('Pause');
    await r.stop();
    await flush();
    expect(calls.map((c) => c.kind)).toEqual(['start', 'stopped']);
  });

  it('a second start while active is a no-op', async () => {
    const { r, calls, session } = setup();
    r.start(session);
    r.start(session);
    await flush();
    expect(calls.filter((c) => c.kind === 'start')).toHaveLength(1);
  });

  it('stop takes the final position override and clamps negatives', async () => {
    const { r, calls, session } = setup();
    r.start(session);
    await r.stop({ positionTicks: -5 });
    expect(calls.at(-1)?.report.positionTicks).toBe(0);
  });

  it('keeps reporting after a failed request and still sends stopped', async () => {
    const { r, calls, t, errors, session } = setup(true);
    r.start(session);
    t.fire();
    await r.stop();
    expect(errors).toHaveLength(1);
    expect(calls.map((c) => c.kind)).toEqual(['start', 'stopped']);
  });

  it('sends reports in order', async () => {
    const order: string[] = [];
    const transport: ProgressTransport = {
      start: () => new Promise((res) => setTimeout(() => (order.push('start'), res()), 20)),
      progress: async () => {
        order.push('progress');
      },
      stopped: async () => {
        order.push('stopped');
      },
    };
    const t = fakeTimer();
    const r = new ProgressReporter(
      transport,
      () => ({ positionTicks: 1, isPaused: false, isMuted: false, playbackRate: 1, audioStreamIndex: null, subtitleStreamIndex: null }),
      t.timer,
    );
    r.start({ itemId: 'i', mediaSourceId: 'm', playSessionId: null, playMethod: 'Transcode', canSeek: true });
    r.tick('Seek');
    await r.stop();
    expect(order).toEqual(['start', 'progress', 'stopped']);
  });
});
