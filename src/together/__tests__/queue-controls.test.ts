/**
 * The queue controls of a listen-together session (next, previous, a jump),
 * from the host and from a guest, with the real room and follower. The fake
 * queue does what the audio session does (`audio/session.ts`): the queue
 * index changes at once, the track loads (`LOAD`), starts when the session
 * asks for it, and then the track listeners hear of it. "Previous" after
 * `RESTART` seconds goes back to the start of the track instead.
 * A guest moves to the group's track the way nearby.ts `moveTo` does.
 */
import { positionAt } from '../drift';
import { Follower } from '../follower';
import { decode, encode, type Anchor, type ControlAction, type Message, type SharedQueue } from '../protocol';
import { HostRoom, type QueueAction, type RoomQueue } from '../room';
import { FakePlayer, VirtualClock } from '../test-utils/sim';

const LOAD = 150;
const RESTART = 3;
const KEYS = ['a', 'b', 'c', 'd', 'e'];
const wire = (m: Message) => decode(encode(m))!;
const HOST_OFFSET = 100_000;
const GUEST_OFFSET = 3_000;

class TrackPlayer extends FakePlayer {
  key = 'a';
  track(): string | null {
    return this.key;
  }
}

class FakeQueue implements RoomQueue {
  index = 0;
  private trackListeners = new Set<(key: string) => void>();
  private loadTimer: unknown = null;
  constructor(
    private readonly clock: VirtualClock,
    private readonly player: TrackPlayer,
  ) {}
  snapshot(): SharedQueue {
    return { entries: KEYS.map((key) => ({ key, item: { id: key, name: key, type: 'Audio' } })), index: this.index, shuffle: false, repeat: 'off', longForm: false };
  }
  track() {
    return KEYS[this.index];
  }
  onTrack(listener: (key: string) => void) {
    this.trackListeners.add(listener);
    return () => this.trackListeners.delete(listener);
  }
  onQueue() {
    return () => undefined;
  }
  apply(c: QueueAction, playing?: boolean): void {
    let index = this.index;
    if (c.action === 'next') index = Math.min(KEYS.length - 1, index + 1);
    else if (c.action === 'jump') index = KEYS.indexOf(c.key);
    else if (c.action === 'previous') {
      if (this.player.position() > RESTART) {
        this.player.seek(0);
        return;
      }
      index = Math.max(0, index - 1);
    } else return;
    if (index === this.index) return;
    this.index = index;
    // The audio session plays a loaded track unless the caller says otherwise.
    const autoplay = playing ?? true;
    const p = this.player;
    p.pause();
    if (this.loadTimer !== null) this.clock.clearTimeout(this.loadTimer);
    this.loadTimer = this.clock.setTimeout(() => {
      this.loadTimer = null;
      p.key = KEYS[this.index];
      p.seek(0);
      if (autoplay) p.play();
      this.trackListeners.forEach((l) => l(p.key));
    }, LOAD);
  }
}

function session(opts: { onlyHostControls?: boolean } = {}) {
  const clock = new VirtualClock();
  const hostNow = () => clock.t + HOST_OFFSET;
  const guestNow = () => clock.t + GUEST_OFFSET;
  const hostPlayer = new TrackPlayer(clock, 40);
  const guestPlayer = new TrackPlayer(clock, 60);
  const queue = new FakeQueue(clock, hostPlayer);
  const denied: string[] = [];
  let room!: HostRoom;
  let follower!: Follower;
  let moving: string | null = null;
  room = new HostRoom(
    { send: (m) => clock.setTimeout(() => follower.receive(wire(m), guestNow()), 15), now: hostNow, player: hostPlayer, timers: clock },
    { sessionId: 's1', item: { id: 'a', name: 'a', type: 'Audio' }, stream: null, onlyHostControls: opts.onlyHostControls ?? false, kind: 'audio', queue },
  );
  follower = new Follower({
    send: (m) => clock.setTimeout(() => room.receive('g', wire(m), hostNow()), 25),
    now: guestNow,
    timers: clock,
    onDenied: (r) => denied.push(r),
    // nearby.ts onTrackMismatch / moveTo: load the group's track at the group position, then follow again.
    onTrackMismatch: (track: string, anchor: Anchor) => {
      if (moving === track) return;
      moving = track;
      guestPlayer.pause();
      clock.setTimeout(() => {
        const hostTime = follower.hostNow();
        guestPlayer.key = track;
        guestPlayer.seek(hostTime !== null ? positionAt(anchor, hostTime) : anchor.position);
        if (anchor.playing) guestPlayer.play();
        moving = null;
        follower.attach(guestPlayer, false);
      }, LOAD);
    },
  });
  follower.start('Guest', []);
  clock.advance(1500);
  follower.attach(guestPlayer, false);
  clock.advance(500);
  room.apply({ action: 'play' });
  clock.advance(5000);
  return {
    clock,
    room,
    follower,
    hostPlayer,
    guestPlayer,
    denied,
    hostUi: (c: ControlAction) => room.apply(c),
    guestUi: (c: ControlAction) => void follower.request(c),
  };
}
type Session = ReturnType<typeof session>;

const SETTLE = 4000;

function agree(s: Session, track: string, playing: boolean, maxGap = 0.2): void {
  expect(s.hostPlayer.key).toBe(track);
  expect(s.guestPlayer.key).toBe(track);
  expect(s.room.state.wantPlaying).toBe(playing);
  expect(s.hostPlayer.isPlaying()).toBe(playing);
  expect(s.guestPlayer.isPlaying()).toBe(playing);
  expect(Math.abs(s.hostPlayer.position() - s.guestPlayer.position())).toBeLessThan(maxGap);
}

describe('listen together queue controls', () => {
  for (const who of ['host', 'guest'] as const) {
    const ui = (s: Session, c: ControlAction) => (who === 'host' ? s.hostUi(c) : s.guestUi(c));

    it(`${who}: next while playing`, () => {
      const s = session();
      ui(s, { action: 'next' });
      s.clock.advance(SETTLE);
      agree(s, 'b', true);
      expect(s.hostPlayer.position()).toBeLessThan(SETTLE / 1000 + 0.5);
    });

    it(`${who}: next while paused stays paused, at the start of the next track`, () => {
      const s = session();
      ui(s, { action: 'pause' });
      s.clock.advance(SETTLE);
      ui(s, { action: 'next' });
      s.clock.advance(SETTLE);
      agree(s, 'b', false);
      expect(s.hostPlayer.position()).toBe(0);
    });

    it(`${who}: previous early in a track goes to the track before`, () => {
      const s = session();
      ui(s, { action: 'jump', key: 'c' });
      s.clock.advance(1000);
      ui(s, { action: 'previous' });
      s.clock.advance(SETTLE);
      agree(s, 'b', true);
    });

    it(`${who}: previous late in a track goes back to its start, on every device at once`, () => {
      const s = session();
      ui(s, { action: 'previous' });
      // Within a second, not at the next heartbeat.
      s.clock.advance(1000);
      agree(s, 'a', true);
      expect(s.hostPlayer.position()).toBeLessThan(1.5);
    });

    it(`${who}: a jump to a queue item`, () => {
      const s = session();
      ui(s, { action: 'jump', key: 'd' });
      s.clock.advance(SETTLE);
      agree(s, 'd', true);
    });

    it(`${who}: three fast nexts: the last one wins`, () => {
      const s = session();
      for (let i = 0; i < 3; i++) {
        ui(s, { action: 'next' });
        s.clock.advance(80);
      }
      s.clock.advance(SETTLE);
      agree(s, 'd', true);
    });

    it(`${who}: play, then next before the planned start`, () => {
      const s = session();
      ui(s, { action: 'pause' });
      s.clock.advance(SETTLE);
      ui(s, { action: 'play' });
      s.clock.advance(100);
      ui(s, { action: 'next' });
      // The group is on the new track within a second, at the same place.
      s.clock.advance(1000);
      agree(s, 'b', true);
      expect(s.hostPlayer.position()).toBeLessThan(1.5);
    });
  }

  it('the host jumps and the guest presses next at the same moment: both agree', () => {
    const s = session();
    s.hostUi({ action: 'jump', key: 'c' });
    s.guestUi({ action: 'next' });
    s.clock.advance(SETTLE);
    // The guest's next reaches the host after the jump.
    agree(s, 'd', true);
  });

  it('"Only I control": the host refuses a guest next, and the guest does not move', () => {
    const s = session({ onlyHostControls: true });
    s.guestUi({ action: 'next' });
    s.guestUi({ action: 'jump', key: 'e' });
    s.clock.advance(SETTLE);
    expect(s.denied).toHaveLength(2);
    agree(s, 'a', true);
  });
});
