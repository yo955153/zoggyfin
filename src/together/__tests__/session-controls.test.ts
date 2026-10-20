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
 * - android: `playbackParameters` never start a player. A seek while it
 *   plays waits for data.
 * - mac: libmpv; a speed change never starts it, and its events come later
 *   (each call goes through the Tauri bridge).
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
const mockEnv: { clock: VirtualClock; platform: Platform; players: MockVideoPlayer[]; direct: unknown } = {
  clock: new VirtualClock(),
  platform: 'ios',
  players: [],
  direct: null,
};

/** Native to JavaScript, ms. */
const EVENT_DELAY: Record<Platform, number> = { ios: 8, android: 8, mac: 40 };
/** A seek while playing waits this long for data, ms. */
const SEEK_STALL = 120;

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
    if (this.platform === 'ios') this.want = true;
    this.update();
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
jest.mock('@/native/zoggyfin-native', () => ({ setAutoPictureInPicture: () => undefined }));
jest.mock('@/player/session', () => ({ videoSession: () => ({ direct: mockEnv.direct }) }));

const item = { id: 'item1', name: 'Film', type: 'Movie' };
const wire = (m: Message) => decode(encode(m))!;
const HOST_OFFSET = 100_000;
const GUEST_OFFSET = 3_000;
const DOWN = 15;
const UP = 25;

interface Device {
  av: MockVideoPlayer;
  port: BoundPort;
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
    const { getEngine } = require('@/player/engine') as typeof import('@/player/engine');
    const { bindVideoPort } = require('../player-binding') as typeof import('../player-binding');
    /* eslint-enable @typescript-eslint/no-require-imports */
    store.usePlayerStore.setState({ ...store.initialPlayerState, now: { kind: 'video' } as never, status: 'ready' });
    const engine = getEngine();
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
    dev = { av, port, outside, dispose: () => (port.dispose(), unsub()) };
  });
  return dev;
}

function session(hostPlatform: Platform, guestPlatform: Platform, opts: { onlyHostControls?: boolean; guestSpeedError?: number } = {}) {
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
    { send: (m) => clock.setTimeout(() => follower.receive(wire(m), guestNow()), DOWN), now: hostNow, player: host.port, timers: clock },
    { sessionId: 's1', item, stream: { service: 'zgf-1', path: '/t/media.mp4' }, onlyHostControls: opts.onlyHostControls ?? false },
  );
  follower = new Follower({
    send: (m) => clock.setTimeout(() => room.receive('g', wire(m), hostNow()), UP),
    now: guestNow,
    timers: clock,
    onDenied: (r) => denied.push(r),
  });
  follower.start('Guest', []);
  clock.advance(1500);
  follower.attach(guest.port, false);
  clock.advance(500);
  room.apply({ action: 'play' });
  clock.advance(3000);
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
type Session = ReturnType<typeof session>;

/** Plays on until the guest's drift correction nudges its rate (the case where a pause used to resume on iOS). */
function untilNudging(s: Session): void {
  for (let i = 0; i < 300 && s.guest.av.playbackRate === 1; i++) s.clock.advance(50);
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
  beforeEach(() => {
    mockEnv.players = [];
    s = session(hostPlatform, guestPlatform);
  });
  afterEach(() => s.dispose());

  for (const who of ['host', 'guest'] as const) {
    const ui = (c: ControlAction) => (who === 'host' ? s.hostUi(c) : s.guestUi(c));

    it(`${who} pauses while the guest nudges its rate`, () => {
      untilNudging(s);
      ui({ action: 'pause' });
      s.clock.advance(SETTLE);
      agree(s, false, 0.3);
    });

    it(`${who} plays after a pause`, () => {
      ui({ action: 'pause' });
      s.clock.advance(SETTLE);
      ui({ action: 'play' });
      s.clock.advance(SETTLE);
      agree(s, true, 0.1);
    });

    it(`${who} seeks forward and back`, () => {
      ui({ action: 'seek', position: 600 });
      s.clock.advance(SETTLE);
      agree(s, true, 0.1);
      expect(s.host.av.currentTime).toBeGreaterThan(600);
      ui({ action: 'seek', position: 120 });
      s.clock.advance(SETTLE);
      agree(s, true, 0.1);
      expect(s.host.av.currentTime).toBeLessThan(130);
    });

    it(`${who} scrubs: ten fast seeks, the last one wins`, () => {
      let target = 200;
      for (let i = 0; i < 10; i++) {
        target += i % 3 === 2 ? -10 : 10;
        ui({ action: 'seek', position: target });
        s.clock.advance(90);
      }
      s.clock.advance(SETTLE);
      agree(s, true, 0.1);
      const expected = target + SETTLE / 1000;
      expect(Math.abs(s.host.av.currentTime - expected)).toBeLessThan(0.5);
    });

    it(`${who} seeks while paused: both stay paused at the new place`, () => {
      ui({ action: 'pause' });
      s.clock.advance(SETTLE);
      ui({ action: 'seek', position: 400 });
      s.clock.advance(SETTLE);
      agree(s, false, 0.3);
      expect(Math.abs(s.host.av.currentTime - 400)).toBeLessThan(0.01);
    });

    it(`${who} changes the rate while playing, and while paused`, () => {
      ui({ action: 'rate', rate: 1.5 });
      s.clock.advance(SETTLE * 2);
      agree(s, true, 0.15);
      expect(s.host.av.playbackRate).toBe(1.5);
      expect(Math.abs(s.guest.av.playbackRate - 1.5)).toBeLessThan(0.1);
      ui({ action: 'pause' });
      s.clock.advance(SETTLE);
      ui({ action: 'rate', rate: 1 });
      s.clock.advance(SETTLE);
      agree(s, false, 0.3);
      ui({ action: 'play' });
      s.clock.advance(SETTLE * 2);
      agree(s, true, 0.15);
      expect(s.host.av.playbackRate).toBe(1);
    });

    it(`${who} pauses just after a play starts, before the engine reports the start`, () => {
      ui({ action: 'pause' });
      s.clock.advance(SETTLE);
      ui({ action: 'play' });
      // The host starts its player 300 ms after a play (startLead); the pause comes 10 ms after that.
      s.clock.advance(who === 'host' ? 310 : 310 + UP);
      ui({ action: 'pause' });
      s.clock.advance(SETTLE);
      agree(s, false, 0.3);
    });

    it(`${who} double-taps +10 s three times while the players report late`, () => {
      const start = s.host.av.currentTime;
      for (let i = 0; i < 3; i++) {
        ui({ action: 'seek', position: start + 10 * (i + 1) + (i * 20) / 1000 });
        s.clock.advance(20);
      }
      s.clock.advance(SETTLE);
      agree(s, true, 0.1);
      expect(Math.abs(s.host.av.currentTime - (start + 30.04 + SETTLE / 1000))).toBeLessThan(0.5);
    });

    it(`${who} toggles fast (pause, play, pause, play, pause)`, () => {
      untilNudging(s);
      for (const action of ['pause', 'play', 'pause', 'play', 'pause'] as const) {
        ui({ action });
        s.clock.advance(130);
      }
      s.clock.advance(SETTLE);
      agree(s, false, 0.3);
    });
  }

  for (const who of ['host', 'guest'] as const) {
    it(`a pause from the ${who}'s lock screen still goes to the group`, () => {
      const dev = who === 'host' ? s.host : s.guest;
      // The system pauses the player itself (no app command).
      dev.av.pause();
      s.clock.advance(SETTLE);
      expect(dev.outside).toEqual(['pause']);
      dev.outside.length = 0;
      agree(s, false, 0.3);
      dev.av.play();
      s.clock.advance(SETTLE);
      expect(dev.outside).toEqual(['play']);
      dev.outside.length = 0;
      agree(s, true, 0.1);
    });
  }

  it('the host pauses and the guest plays at the same moment: the host decides, both agree', () => {
    s.hostUi({ action: 'pause' });
    s.guestUi({ action: 'play' });
    s.clock.advance(SETTLE);
    // The guest's play reaches the host last.
    agree(s, true, 0.1);
  });

  it('the guest pauses and the host seeks at the same moment: both agree', () => {
    s.guestUi({ action: 'pause' });
    s.hostUi({ action: 'seek', position: 500 });
    s.clock.advance(SETTLE);
    agree(s, false, 0.3);
    expect(Math.abs(s.host.av.currentTime - 500)).toBeLessThan(0.3);
  });

  it('a pause in the members merge window holds', () => {
    untilNudging(s);
    s.room.receive('g2', { t: 'hello', name: 'Pixel', have: [], memberId: 'm2', deltas: true }, s.clock.t + HOST_OFFSET);
    s.clock.advance(100);
    s.guestUi({ action: 'pause' });
    s.clock.advance(SETTLE);
    agree(s, false, 0.3);
  });
});

describe.each(PAIRS)('"Only I control": %s host, %s guest', (hostPlatform, guestPlatform) => {
  it('refuses each guest control: nothing goes to the host, and the guest player does not move', () => {
    mockEnv.players = [];
    const s = session(hostPlatform, guestPlatform, { onlyHostControls: true, guestSpeedError: 0 });
    s.clock.advance(1000);
    const states = new Set<boolean>();
    const controls: ControlAction[] = [{ action: 'pause' }, { action: 'seek', position: 50 }, { action: 'rate', rate: 2 }, { action: 'play' }];
    for (const c of controls) {
      s.guestUi(c);
      for (let i = 0; i < 50; i++) {
        s.clock.advance(10);
        states.add(s.guest.av.playing);
      }
    }
    expect(s.denied).toHaveLength(controls.length);
    expect([...states]).toEqual([true]);
    expect(s.room.state.wantPlaying).toBe(true);
    agree(s, true, 0.1);
    // A pause from the guest's lock screen is undone (the guest may not control).
    s.guest.av.pause();
    s.clock.advance(SETTLE);
    expect(s.guest.outside).toEqual(['pause']);
    s.guest.outside.length = 0;
    agree(s, true, 0.2);
    // The host still controls.
    s.hostUi({ action: 'pause' });
    s.clock.advance(SETTLE);
    agree(s, false, 0.3);
    s.dispose();
  });
});

describe.each<Platform>(['ios', 'android', 'mac'])('SyncPlay (the same binding and AnchorFollower): %s', (platform) => {
  it('a server pause while the player nudges its rate holds, with no echo to the server', () => {
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
    for (let i = 0; i < 300 && dev.av.playbackRate === 1; i++) clock.advance(50);
    expect(dev.av.playbackRate).not.toBe(1);
    f.setAnchor({ playing: false, rate: 1, hostTime: serverNow(), position: dev.av.currentTime });
    clock.advance(SETTLE);
    expect(sent).toEqual([]);
    expect(dev.av.playing).toBe(false);
    f.setAnchor({ playing: true, rate: 1, hostTime: serverNow() + 300, position: dev.av.currentTime });
    clock.advance(SETTLE);
    expect(sent).toEqual([]);
    expect(dev.av.playing).toBe(true);
    clock.clearInterval(tick);
    f.detach();
    dev.dispose();
  });
});
