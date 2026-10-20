/**
 * Every group control in a nearby video session, from the host and from a
 * guest, with each device's real stack: a fake expo-video player with the
 * platform's rules, the app's native engine (`engine.native.tsx`), its own
 * player store, the video binding, and the room or the follower. Each
 * device loads its own copy of the modules (`jest.isolateModules`).
 *
 * Platform rules of the fake player:
 * - ios: expo-video sets `AVPlayer.rate` for `playbackRate`, and a rate
 *   above zero starts a paused AVPlayer. A seek while it plays waits for data.
 *   A rate change while it plays makes it wait for a moment
 *   (`timeControlStatus` goes to waitingToPlayAtSpecifiedRate with no status
 *   change), so `isPlaying` is false for about `RATE_WAIT`.
 * - android: `playbackParameters` never start a player. A seek while it
 *   plays waits for data.
 * - mac: the desktop app's real engine (`engine-mpv.ts`) on a fake libmpv:
 *   each call crosses the Tauri bridge, each property change comes back as
 *   an event later, `time-pos` comes four times a second, a seek stops the
 *   picture for a moment, and a speed change never starts it.
 *
 * No test uses the lock screen, so every control the binding sends from an
 * engine event (`outside`) is an echo of the app's own command.
 */
import { Follower } from '../follower';
import type { BoundPort } from '../player-binding';
import { decode, encode, type ControlAction, type Message } from '../protocol';
import { HostRoom } from '../room';
import { VirtualClock } from '../test-utils/sim';

type Platform = 'ios' | 'android' | 'mac';

/** Shared with the jest.mock factories (their names must start with `mock`). */
const mockEnv: { clock: VirtualClock; platform: Platform; players: (MockVideoPlayer | MockMpv)[]; direct: unknown } = {
  clock: new VirtualClock(),
  platform: 'ios',
  players: [],
  direct: null,
};

/** libmpv: a call takes this long through the Tauri bridge, and its event this long more, ms. */
const MPV_CALL = 4;
const MPV_EVENT = 30;
/** libmpv: a seek holds the picture this long, ms. */
const MPV_SEEK = 60;

/** libmpv in the desktop app, as `engine-mpv.ts` sees it through `@/platform/desktop`. */
class MockMpv {
  private listeners = new Set<(e: unknown) => void>();
  private base = 0;
  private since = 0;
  private paused = false;
  private seeking = false;
  private loaded = false;
  private speed = 1;
  speedError = 0;
  private tick: unknown = null;

  constructor() {
    this.tick = mockEnv.clock.setInterval(() => {
      if (this.moving) this.event({ type: 'prop', name: 'time-pos', value: this.currentTime });
    }, 250);
  }
  subscribe(l: (e: unknown) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private event(e: unknown) {
    mockEnv.clock.setTimeout(() => this.listeners.forEach((l) => l(e)), MPV_EVENT);
  }
  private get moving(): boolean {
    return this.loaded && !this.paused && !this.seeking;
  }
  private settle() {
    const t = mockEnv.clock.t;
    if (this.moving) this.base += ((t - this.since) / 1000) * this.speed * (1 + this.speedError);
    this.since = t;
  }
  /** The bridge call: the change happens when the call reaches libmpv. */
  private call(fn: () => void): Promise<void> {
    return new Promise((resolve) =>
      mockEnv.clock.setTimeout(() => {
        fn();
        resolve();
      }, MPV_CALL),
    );
  }
  private setPause(p: boolean) {
    if (p === this.paused) return;
    this.settle();
    this.paused = p;
    this.event({ type: 'prop', name: 'pause', value: p });
    if (p) this.event({ type: 'prop', name: 'time-pos', value: this.base });
  }
  set(name: string, value: string | number | boolean) {
    const v = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
    return this.call(() => {
      if (name === 'pause') this.setPause(v === 'yes');
      if (name === 'speed') {
        this.settle();
        this.speed = Number(v);
        this.event({ type: 'prop', name: 'speed', value: this.speed });
      }
    });
  }
  get(_name: string) {
    return Promise.resolve(null);
  }
  command(...args: (string | number)[]) {
    return this.call(() => {
      if (args[0] === 'loadfile') {
        this.loaded = true;
        this.since = mockEnv.clock.t;
        this.event({ type: 'file-loaded' });
      } else if (args[0] === 'seek') {
        this.settle();
        this.base = Math.max(0, Number(args[1]));
        this.seeking = true;
        this.event({ type: 'prop', name: 'seeking', value: true });
        mockEnv.clock.setTimeout(() => {
          this.settle();
          this.seeking = false;
          this.event({ type: 'prop', name: 'time-pos', value: this.base });
          this.event({ type: 'playback-restart' });
          this.event({ type: 'prop', name: 'seeking', value: false });
        }, MPV_SEEK);
      }
    });
  }
  // The test's view of the player (the same as MockVideoPlayer).
  get playing(): boolean {
    return this.moving;
  }
  get currentTime(): number {
    this.settle();
    return this.base;
  }
  get playbackRate(): number {
    return this.speed;
  }
  /** From outside the app (Now Playing, a media key): libmpv changes by itself. */
  play() {
    this.setPause(false);
  }
  pause() {
    this.setPause(true);
  }
  dispose() {
    mockEnv.clock.clearInterval(this.tick);
  }
}

/** Native to JavaScript, ms. */
const EVENT_DELAY: Record<Platform, number> = { ios: 8, android: 8, mac: 40 };
/** A seek while playing waits this long for data, ms. */
const SEEK_STALL = 120;
/** iOS: a rate change while playing stops the player for this long, ms. */
const RATE_WAIT = 30;

class MockVideoPlayer {
  readonly platform = mockEnv.platform;
  private listeners = new Map<string, Set<(e: never) => void>>();
  private base = 0;
  private since = 0;
  /** The player moves at this rate (0: paused or waiting). */
  private moving = 0;
  /** The player wants to play (AVPlayer.rate > 0, ExoPlayer playWhenReady). */
  private want = false;
  private wanted = 1;
  private stallTimer: unknown = null;
  speedError = 0;
  playing = false;
  timeUpdateEventInterval = 0;
  staysActiveInBackground = false;
  showNowPlayingNotification = false;
  allowsExternalPlayback = false;
  audioMixingMode = 'doNotMix';
  keepScreenOnWhilePlaying = false;
  bufferOptions: unknown = null;
  muted = false;

  addListener(name: string, fn: (e: never) => void) {
    const set = this.listeners.get(name) ?? new Set();
    set.add(fn);
    this.listeners.set(name, set);
    return { remove: () => set.delete(fn) };
  }
  private emit(name: string, payload: unknown) {
    mockEnv.clock.setTimeout(() => this.listeners.get(name)?.forEach((l) => l(payload as never)), EVENT_DELAY[this.platform]);
  }
  private settle() {
    const t = mockEnv.clock.t;
    this.base += ((t - this.since) / 1000) * this.moving * (1 + this.speedError);
    this.since = t;
  }
  private update() {
    this.settle();
    const stalled = this.stallTimer !== null;
    this.moving = this.want && !stalled ? this.wanted : 0;
    const now = this.want && !stalled;
    if (now !== this.playing) {
      this.playing = now;
      this.emit('playingChange', { isPlaying: now });
    }
  }
  replace() {
    this.emit('statusChange', { status: 'readyToPlay' });
  }
  play() {
    this.want = true;
    this.update();
  }
  pause() {
    this.want = false;
    this.update();
  }
  release() {}
  /** The engine's position: the moving media position. */
  get currentTime() {
    this.settle();
    return this.base;
  }
  set currentTime(s: number) {
    this.settle();
    this.base = Math.max(0, s);
    if (this.platform === 'mac' || !this.want) return;
    // A seek while playing: the player waits for data, then goes on.
    if (this.stallTimer !== null) mockEnv.clock.clearTimeout(this.stallTimer);
    else this.emit('statusChange', { status: 'loading' });
    this.stallTimer = mockEnv.clock.setTimeout(() => {
      this.stallTimer = null;
      this.emit('statusChange', { status: 'readyToPlay' });
      this.update();
    }, SEEK_STALL);
    this.update();
  }
  get playbackRate() {
    return this.wanted;
  }
  set playbackRate(r: number) {
    this.settle();
    this.wanted = r;
    this.emit('playbackRateChange', { playbackRate: r });
    // expo-video iOS: `ref.rate = playbackRate`, which plays a paused AVPlayer.
    const wasPlaying = this.playing;
    if (this.platform === 'ios') this.want = true;
    this.update();
    if (this.platform === 'ios' && wasPlaying && this.playing) {
      // AVPlayer waits for a moment after the rate change: `isPlaying` goes false, then true.
      this.emit('playingChange', { isPlaying: false });
      mockEnv.clock.setTimeout(() => {
        if (this.playing) this.emit('playingChange', { isPlaying: true });
      }, RATE_WAIT);
    }
  }
}

jest.mock('expo-video', () => ({
  createVideoPlayer: () => {
    const p = new MockVideoPlayer();
    mockEnv.players.push(p);
    return p;
  },
  isPictureInPictureSupported: () => false,
  VideoView: () => null,
}));
jest.mock('@/platform/desktop', () => {
  const m = new MockMpv();
  mockEnv.players.push(m);
  return {
    mpv: m,
    nowPlaying: { update: () => Promise.resolve(), clear: () => Promise.resolve(), onRemote: () => () => undefined },
    desktopWindow: { toggleFullscreen: () => Promise.resolve(false) },
    localPath: (uri: string) => uri,
  };
});
jest.mock('@/native/zoggyfin-native', () => ({ setAutoPictureInPicture: () => undefined }));
jest.mock('@/player/session', () => ({ videoSession: () => ({ direct: mockEnv.direct }) }));

// The desktop engine reads the time with performance.now (position-line.ts): the virtual clock.
beforeAll(() => jest.spyOn(performance, 'now').mockImplementation(() => mockEnv.clock.t));
afterAll(() => jest.restoreAllMocks());

const item = { id: 'item1', name: 'Film', type: 'Movie' };
const wire = (m: Message) => decode(encode(m))!;
const HOST_OFFSET = 100_000;
const GUEST_OFFSET = 3_000;
const DOWN = 15;
const UP = 25;

interface Device {
  av: MockVideoPlayer | MockMpv;
  port: BoundPort;
  /** This device's control gate (the session tells it what the group wants). */
  gate: typeof import('@/player/control-gate');
  /** What a tap on the play button sends now (`VideoSession.togglePlay`). */
  tapAction(): 'play' | 'pause';
  /** Controls the binding sent from engine events. */
  outside: string[];
  dispose(): void;
}

/** One device: its own engine, store and binding. `onOutside` gets the binding's controls. */
function device(platform: Platform, onOutside: (c: ControlAction) => void, endPauses: boolean): Device {
  let dev!: Device;
  mockEnv.platform = platform;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const store = require('@/player/store') as typeof import('@/player/store');
    const gate = require('@/player/control-gate') as typeof import('@/player/control-gate');
    const engine =
      platform === 'mac'
        ? new (require('@/player/engine-mpv') as typeof import('@/player/engine-mpv')).MpvEngine()
        : (require('@/player/engine') as typeof import('@/player/engine')).getEngine();
    const { bindVideoPort } = require('../player-binding') as typeof import('../player-binding');
    /* eslint-enable @typescript-eslint/no-require-imports */
    store.usePlayerStore.setState({ ...store.initialPlayerState, now: { kind: 'video' } as never, status: 'ready' });
    engine.load({ uri: 'http://host/media.mp4', isHls: false, startSeconds: 0, title: 'Film', autoplay: false });
    const av = mockEnv.players[mockEnv.players.length - 1];
    // The part of VideoSession that writes the store.
    const unsub = engine.subscribe((e) => {
      const st = store.playerState();
      if (e.type === 'playing' && e.playing !== st.playing) store.setPlayerState({ playing: e.playing });
      if (e.type === 'status') store.setPlayerState({ status: e.status === 'loading' ? 'buffering' : e.status === 'ready' ? 'ready' : st.status });
      if (e.type === 'rate') store.setPlayerState({ rate: e.rate });
    });
    mockEnv.direct = {
      play: () => engine.play(),
      pause: () => engine.pause(),
      seek: (s: number) => engine.seekTo(s),
      rate: (r: number) => engine.setRate(r),
      position: () => engine.position,
    };
    const outside: string[] = [];
    const port = bindVideoPort(
      (c) => {
        outside.push(c.action);
        onOutside(c);
      },
      { endPauses, timers: mockEnv.clock },
    );
    // The session takes the controls (nearby.ts sets the gate's handler).
    gate.controlGate.set(() => true);
    const tapAction = () => (gate.togglePauses(store.playerState().playing) ? 'pause' : 'play') as 'play' | 'pause';
    dev = { av, port, outside, gate, tapAction, dispose: () => (port.dispose(), unsub(), gate.controlGate.set(null), av instanceof MockMpv && av.dispose()) };
  });
  return dev;
}

async function session(hostPlatform: Platform, guestPlatform: Platform, opts: { onlyHostControls?: boolean; guestSpeedError?: number } = {}) {
  const clock = new VirtualClock();
  mockEnv.clock = clock;
  const hostNow = () => clock.t + HOST_OFFSET;
  const guestNow = () => clock.t + GUEST_OFFSET;
  let room!: HostRoom;
  let follower!: Follower;
  const denied: string[] = [];
  const host = device(hostPlatform, (c) => room.apply(c), true);
  const guest = device(
    guestPlatform,
    (c) => {
      // nearby.ts: a guest that may not control undoes the change.
      if (!follower.request(c)) {
        if (c.action === 'play') guest.port.pause();
        else if (c.action === 'pause') guest.port.play();
      }
    },
    false,
  );
  guest.av.speedError = opts.guestSpeedError ?? 0.02;
  room = new HostRoom(
    {
      send: (m) => clock.setTimeout(() => follower.receive(wire(m), guestNow()), DOWN),
      now: hostNow,
      player: host.port,
      timers: clock,
      // nearby.ts publishHost: the play button follows the room.
      onChange: () => host.gate.controlGate.setPlaying(room.hasMedia ? room.state.wantPlaying : null),
    },
    { sessionId: 's1', item, stream: { service: 'zgf-1', path: '/t/media.mp4' }, onlyHostControls: opts.onlyHostControls ?? false },
  );
  follower = new Follower({
    send: (m) => clock.setTimeout(() => room.receive('g', wire(m), hostNow()), UP),
    now: guestNow,
    timers: clock,
    onDenied: (r) => denied.push(r),
    // nearby.ts publishGuest: the play button follows the group and this guest's last play or pause.
    onChange: () => guest.gate.controlGate.setPlaying(follower.wantsPlay),
  });
  follower.start('Guest', []);
  await advance(clock, 1500);
  follower.attach(guest.port, false);
  await advance(clock, 500);
  room.apply({ action: 'play' });
  await advance(clock, 3000);
  const s = {
    clock,
    room,
    follower,
    host,
    guest,
    denied,
    /** A control from the host's UI (the control gate goes to the room). */
    hostUi: (c: ControlAction) => room.apply(c),
    /** A control from the guest's UI (the control gate goes to the follower). */
    guestUi: (c: ControlAction) => void follower.request(c),
    /** The positions of the two players differ by this much, seconds. */
    gap: () => Math.abs(host.av.currentTime - guest.av.currentTime),
    dispose: () => {
      follower.dispose();
      room.dispose();
      host.dispose();
      guest.dispose();
    },
  };
  return s;
}
type Session = Awaited<ReturnType<typeof session>>;

/** Plays on until the guest's drift correction nudges its rate (the case where a pause used to resume on iOS). */
async function untilNudging(s: Session): Promise<void> {
  for (let i = 0; i < 300 && s.guest.av.playbackRate === 1; i++) await advance(s.clock, 50);
  expect(s.guest.av.playbackRate).not.toBe(1);
}

/** Both devices play (or not), at the same place, and no device echoed a control. */
function agree(s: Session, playing: boolean, maxGap = 0.2): void {
  expect(s.host.outside).toEqual([]);
  expect(s.guest.outside).toEqual([]);
  expect(s.room.state.wantPlaying).toBe(playing);
  expect(s.host.av.playing).toBe(playing);
  expect(s.guest.av.playing).toBe(playing);
  expect(s.gap()).toBeLessThan(maxGap);
}

const PAIRS: [Platform, Platform][] = [
  ['mac', 'ios'],
  ['ios', 'mac'],
  ['mac', 'android'],
  ['android', 'mac'],
  ['ios', 'android'],
  ['android', 'ios'],
];

const SETTLE = 4000;

describe.each(PAIRS)('nearby video session: %s host, %s guest', (hostPlatform, guestPlatform) => {
  let s: Session;
  beforeEach(async () => {
    mockEnv.players = [];
    s = await session(hostPlatform, guestPlatform);
  });
  afterEach(() => s.dispose());

  for (const who of ['host', 'guest'] as const) {
    const ui = (c: ControlAction) => (who === 'host' ? s.hostUi(c) : s.guestUi(c));

    it(`${who} pauses while the guest nudges its rate`, async () => {
      await untilNudging(s);
      ui({ action: 'pause' });
      await advance(s.clock, SETTLE);
      agree(s, false, 0.3);
    });

    it(`${who} plays after a pause`, async () => {
      ui({ action: 'pause' });
      await advance(s.clock, SETTLE);
      ui({ action: 'play' });
      await advance(s.clock, SETTLE);
      agree(s, true, 0.1);
    });

    it(`${who} seeks forward and back`, async () => {
      ui({ action: 'seek', position: 600 });
      await advance(s.clock, SETTLE);
      agree(s, true, 0.1);
      expect(s.host.av.currentTime).toBeGreaterThan(600);
      ui({ action: 'seek', position: 120 });
      await advance(s.clock, SETTLE);
      agree(s, true, 0.1);
      expect(s.host.av.currentTime).toBeLessThan(130);
    });

    it(`${who} scrubs: ten fast seeks, the last one wins`, async () => {
      let target = 200;
      for (let i = 0; i < 10; i++) {
        target += i % 3 === 2 ? -10 : 10;
        ui({ action: 'seek', position: target });
        await advance(s.clock, 90);
      }
      await advance(s.clock, SETTLE);
      agree(s, true, 0.1);
      const expected = target + SETTLE / 1000;
      expect(Math.abs(s.host.av.currentTime - expected)).toBeLessThan(0.5);
    });

    it(`${who} seeks while paused: both stay paused at the new place`, async () => {
      ui({ action: 'pause' });
      await advance(s.clock, SETTLE);
      ui({ action: 'seek', position: 400 });
      await advance(s.clock, SETTLE);
      agree(s, false, 0.3);
      expect(Math.abs(s.host.av.currentTime - 400)).toBeLessThan(0.01);
    });

    it(`${who} changes the rate while playing, and while paused`, async () => {
      ui({ action: 'rate', rate: 1.5 });
      await advance(s.clock, SETTLE * 2);
      agree(s, true, 0.15);
      expect(s.host.av.playbackRate).toBe(1.5);
      expect(Math.abs(s.guest.av.playbackRate - 1.5)).toBeLessThan(0.1);
      ui({ action: 'pause' });
      await advance(s.clock, SETTLE);
      ui({ action: 'rate', rate: 1 });
      await advance(s.clock, SETTLE);
      agree(s, false, 0.3);
      ui({ action: 'play' });
      await advance(s.clock, SETTLE * 2);
      agree(s, true, 0.15);
      expect(s.host.av.playbackRate).toBe(1);
    });

    it(`${who} pauses just after a play starts, before the engine reports the start`, async () => {
      ui({ action: 'pause' });
      await advance(s.clock, SETTLE);
      ui({ action: 'play' });
      // The host starts its player 300 ms after a play (startLead); the pause comes 10 ms after that.
      await advance(s.clock, who === 'host' ? 310 : 310 + UP);
      ui({ action: 'pause' });
      await advance(s.clock, SETTLE);
      agree(s, false, 0.3);
    });

    it(`${who} double-taps +10 s three times while the players report late`, async () => {
      const start = s.host.av.currentTime;
      for (let i = 0; i < 3; i++) {
        ui({ action: 'seek', position: start + 10 * (i + 1) + (i * 20) / 1000 });
        await advance(s.clock, 20);
      }
      await advance(s.clock, SETTLE);
      agree(s, true, 0.1);
      expect(Math.abs(s.host.av.currentTime - (start + 30.04 + SETTLE / 1000))).toBeLessThan(0.5);
    });

    it(`${who} toggles fast (pause, play, pause, play, pause)`, async () => {
      await untilNudging(s);
      for (const action of ['pause', 'play', 'pause', 'play', 'pause'] as const) {
        ui({ action });
        await advance(s.clock, 130);
      }
      await advance(s.clock, SETTLE);
      agree(s, false, 0.3);
    });
  }

  for (const who of ['host', 'guest'] as const) {
    it(`a pause from the ${who}'s lock screen still goes to the group`, async () => {
      const dev = who === 'host' ? s.host : s.guest;
      // The system pauses the player itself (no app command).
      dev.av.pause();
      await advance(s.clock, SETTLE);
      expect(dev.outside).toEqual(['pause']);
      dev.outside.length = 0;
      agree(s, false, 0.3);
      dev.av.play();
      await advance(s.clock, SETTLE);
      expect(dev.outside).toEqual(['play']);
      dev.outside.length = 0;
      agree(s, true, 0.1);
    });
  }

  it('the host pauses and the guest plays at the same moment: the host decides, both agree', async () => {
    s.hostUi({ action: 'pause' });
    s.guestUi({ action: 'play' });
    await advance(s.clock, SETTLE);
    // The guest's play reaches the host last.
    agree(s, true, 0.1);
  });

  it('the guest pauses and the host seeks at the same moment: both agree', async () => {
    s.guestUi({ action: 'pause' });
    s.hostUi({ action: 'seek', position: 500 });
    await advance(s.clock, SETTLE);
    agree(s, false, 0.3);
    expect(Math.abs(s.host.av.currentTime - 500)).toBeLessThan(0.3);
  });

  it('a pause in the members merge window holds', async () => {
    await untilNudging(s);
    s.room.receive('g2', { t: 'hello', name: 'Pixel', have: [], memberId: 'm2', deltas: true }, s.clock.t + HOST_OFFSET);
    await advance(s.clock, 100);
    s.guestUi({ action: 'pause' });
    await advance(s.clock, SETTLE);
    agree(s, false, 0.3);
  });
});

describe.each(PAIRS)('"Only I control": %s host, %s guest', (hostPlatform, guestPlatform) => {
  it('refuses each guest control: nothing goes to the host, and the guest player does not move', async () => {
    mockEnv.players = [];
    const s = await session(hostPlatform, guestPlatform, { onlyHostControls: true, guestSpeedError: 0 });
    await advance(s.clock, 1000);
    const states = new Set<boolean>();
    const controls: ControlAction[] = [{ action: 'pause' }, { action: 'seek', position: 50 }, { action: 'rate', rate: 2 }, { action: 'play' }];
    for (const c of controls) {
      s.guestUi(c);
      for (let i = 0; i < 50; i++) {
        await advance(s.clock, 10);
        states.add(s.guest.av.playing);
      }
    }
    expect(s.denied).toHaveLength(controls.length);
    expect([...states]).toEqual([true]);
    expect(s.room.state.wantPlaying).toBe(true);
    agree(s, true, 0.1);
    // A pause from the guest's lock screen is undone (the guest may not control).
    s.guest.av.pause();
    await advance(s.clock, SETTLE);
    expect(s.guest.outside).toEqual(['pause']);
    s.guest.outside.length = 0;
    agree(s, true, 0.2);
    // The host still controls.
    s.hostUi({ action: 'pause' });
    await advance(s.clock, SETTLE);
    agree(s, false, 0.3);
    s.dispose();
  });
});

describe.each<Platform>(['ios', 'android', 'mac'])('SyncPlay (the same binding and AnchorFollower): %s', (platform) => {
  it('a server pause while the player nudges its rate holds, with no echo to the server', async () => {
    mockEnv.players = [];
    const clock = new VirtualClock();
    mockEnv.clock = clock;
    const sent: string[] = [];
    // syncplay.ts bindPlayer: the binding's controls go to the server.
    const dev = device(platform, (c) => sent.push(c.action), false);
    dev.av.speedError = 0.02;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnchorFollower } = require('../anchor-follower') as typeof import('../anchor-follower');
    const serverNow = () => clock.t + 50_000;
    const f = new AnchorFollower({ now: () => clock.t, remoteNow: serverNow, timers: clock });
    f.attach(dev.port);
    f.setAnchor({ playing: true, rate: 1, hostTime: serverNow() + 300, position: 10 });
    const tick = clock.setInterval(() => f.follow(false), 500);
    for (let i = 0; i < 300 && dev.av.playbackRate === 1; i++) await advance(clock, 50);
    expect(dev.av.playbackRate).not.toBe(1);
    f.setAnchor({ playing: false, rate: 1, hostTime: serverNow(), position: dev.av.currentTime });
    await advance(clock, SETTLE);
    expect(sent).toEqual([]);
    expect(dev.av.playing).toBe(false);
    f.setAnchor({ playing: true, rate: 1, hostTime: serverNow() + 300, position: dev.av.currentTime });
    await advance(clock, SETTLE);
    expect(sent).toEqual([]);
    expect(dev.av.playing).toBe(true);
    clock.clearInterval(tick);
    f.detach();
    dev.dispose();
  });
});

/** A small seeded random source, so a failing stress run repeats. */
/**
 * Runs the virtual clock 1 ms at a time and lets promise callbacks run in
 * between: the desktop engine chains its libmpv calls with promises.
 */
async function advance(clock: VirtualClock, ms: number): Promise<void> {
  for (let i = 0; i < ms; i++) {
    clock.advance(1);
    for (let k = 0; k < 10; k++) await Promise.resolve();
  }
}

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x1_0000_0000;
  };
}

/**
 * The play button, tapped fast: 50 taps with 100–1500 ms between them, from
 * the host, the guest, or both. Each tap is what the user sees on the
 * button (`tapAction`), and the user alternates pause and play. Checks:
 * - each tap sends the opposite of the tap before (no "play" for a pause);
 * - no transient resume: a device that paused for a pause does not play
 *   again before the next play (and a device that plays for a play does
 *   not stop before the next pause);
 * - no device sends a control from an engine event (an echo);
 * - at the end both players are in the state of the last tap.
 */
/**
 * A device may leave the asked state for less than this, ms: a pause that
 * reaches the host just after a planned start it sent already (the network
 * is not instant). The bug that this guards against held for 300 ms or more.
 */
const GLITCH_MS = 60;

describe.each(PAIRS)('play button stress: %s host, %s guest', (hostPlatform, guestPlatform) => {
  for (const who of ['host', 'guest', 'both'] as const) {
    for (const seed of [1, 2, 3]) {
      it(`50 taps from ${who} (seed ${seed})`, async () => {
        mockEnv.players = [];
        const s = await session(hostPlatform, guestPlatform);
        const rand = rng(seed * 7919 + who.length);
        await untilNudging(s);
        let intended = true;
        const sent: string[] = [];
        const wrong: string[] = [];
        const glitches: string[] = [];
        // Per device: whether it reached the state of the last tap, and when a glitch (leaving it again) began.
        const devices = { host: s.host, guest: s.guest };
        const reached = { host: true, guest: true };
        const since: { host: number | null; guest: number | null } = { host: null, guest: null };
        const close = (k: 'host' | 'guest') => {
          const from = since[k];
          if (from !== null && s.clock.t - from > GLITCH_MS) glitches.push(`${k} ${intended ? 'stopped' : 'resumed'} for ${s.clock.t - from} ms at ${from} (asked: ${intended ? 'play' : 'pause'})`);
          since[k] = null;
        };
        const sample = () => {
          for (const k of ['host', 'guest'] as const) {
            const playing = devices[k].av.playing;
            if (playing === intended) {
              close(k);
              reached[k] = true;
            } else if (reached[k] && since[k] === null) since[k] = s.clock.t;
          }
        };
        const run = async (ms: number) => {
          for (let t = 0; t < ms; t += 10) {
            await advance(s.clock, 10);
            sample();
          }
        };
        for (let i = 0; i < 50; i++) {
          const side = who === 'both' ? (rand() < 0.5 ? 'host' : 'guest') : who;
          const dev = devices[side];
          const action = dev.tapAction();
          const want = !intended;
          if ((action === 'play') !== want) wrong.push(`tap ${i} on ${side} at ${s.clock.t}: sent ${action}, the user wanted ${want ? 'play' : 'pause'}`);
          sent.push(action);
          close('host');
          close('guest');
          intended = action === 'play';
          reached.host = reached.guest = false;
          if (side === 'host') s.hostUi({ action });
          else s.guestUi({ action });
          await run(100 + Math.floor(rand() * 1400));
        }
        await run(SETTLE);
        close('host');
        close('guest');
        expect({ wrong, glitches }).toEqual({ wrong: [], glitches: [] });
        agree(s, intended, intended ? 0.15 : 0.3);
        s.dispose();
      });
    }
  }
});
