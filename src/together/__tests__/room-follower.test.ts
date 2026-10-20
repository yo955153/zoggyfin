import { AnchorFollower } from '../anchor-follower';
import { Follower } from '../follower';
import { decode, encode, type Message } from '../protocol';
import { HostRoom } from '../room';
import { FakePlayer, VirtualClock } from '../test-utils/sim';

const item = { id: 'item1', name: 'Film', type: 'Movie' };

/** A host and one guest with different clocks and an asymmetric link (15 ms down, 25 ms up). */
function setup(opts: { guestLatency?: number; guestSpeedError?: number; onlyHostControls?: boolean; hostPaused?: boolean } = {}) {
  const clock = new VirtualClock();
  const hostNow = () => clock.t + 100_000;
  const guestNow = () => clock.t + 3_000;
  const hostPlayer = new FakePlayer(clock, 80);
  const guestPlayer = new FakePlayer(clock, opts.guestLatency ?? 120, opts.guestSpeedError ?? 0);
  const wire = (m: Message) => decode(encode(m))!;
  const denied: string[] = [];
  let follower: Follower;
  if (!opts.hostPaused) hostPlayer.play();
  clock.advance(5000);
  const room = new HostRoom(
    {
      send: (m) => clock.setTimeout(() => follower.receive(wire(m), guestNow()), 15),
      now: hostNow,
      player: hostPlayer,
      timers: clock,
    },
    { sessionId: 's1', item, stream: { service: 'zgf-1', path: '/t/media.mp4' }, onlyHostControls: opts.onlyHostControls ?? false },
  );
  follower = new Follower({
    send: (m) => clock.setTimeout(() => room.receive('g', wire(m), hostNow()), 25),
    now: guestNow,
    timers: clock,
    onDenied: (r) => denied.push(r),
  });
  follower.start('iPad', []);
  clock.advance(1500);
  return { clock, room, follower, hostPlayer, guestPlayer, denied };
}

const gap = (a: FakePlayer, b: FakePlayer) => Math.abs(a.position() - b.position());

describe('nearby session (simulated)', () => {
  it('a new guest catches up while the group plays: nobody waits for it', () => {
    const { clock, room, follower, hostPlayer, guestPlayer } = setup();
    // The guest is loading, but the group plays on.
    expect(room.state.waiting).toBe(false);
    expect(hostPlayer.isPlaying()).toBe(true);
    expect(room.memberList).toMatchObject([{ id: 'g', name: 'iPad', local: false, buffering: true, away: false }]);

    follower.attach(guestPlayer, false);
    clock.advance(1000);
    expect(room.state.waiting).toBe(false);
    expect(guestPlayer.isPlaying()).toBe(true);
    clock.advance(10_000);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.06);
    const est = follower.stats.clock!;
    // True offset is 97 000 ms; the asymmetric link adds (15 - 25) / 2 = -5 ms.
    expect(Math.abs(est.offset - 97_000)).toBeLessThanOrEqual(5);
    expect(est.rtt).toBe(40);
  });

  it('a paused group waits for a new guest when it plays, then starts both together', () => {
    const { clock, room, follower, hostPlayer, guestPlayer } = setup({ hostPaused: true });
    room.apply({ action: 'play' });
    clock.advance(100);
    // The guest still loads: the group waits for it.
    expect(room.state.waiting).toBe(true);
    expect(hostPlayer.isPlaying()).toBe(false);
    follower.attach(guestPlayer, false);
    clock.advance(1000);
    expect(room.state.waiting).toBe(false);
    expect(hostPlayer.isPlaying()).toBe(true);
    expect(guestPlayer.isPlaying()).toBe(true);
    clock.advance(5000);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.06);
  });

  it('corrects a player that runs 1 % fast with rate nudges and no seek', () => {
    const { clock, follower, hostPlayer, guestPlayer } = setup({ guestSpeedError: 0.01 });
    follower.attach(guestPlayer, false);
    clock.advance(1000);
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      clock.advance(500);
      worst = Math.max(worst, gap(hostPlayer, guestPlayer));
    }
    expect(worst).toBeLessThan(0.2);
    expect(follower.stats.corrections.seek).toBe(0);
    expect(follower.stats.corrections.rate).toBeGreaterThan(0);
  });

  it('seeks a guest that is far behind', () => {
    const { clock, follower, hostPlayer, guestPlayer } = setup();
    follower.attach(guestPlayer, false);
    clock.advance(2000);
    guestPlayer.seek(guestPlayer.position() - 5);
    clock.advance(3000);
    expect(follower.stats.corrections.seek).toBe(1);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.2);
  });

  it('follows host seek, pause and rate', () => {
    const { clock, room, follower, hostPlayer, guestPlayer } = setup();
    follower.attach(guestPlayer, false);
    clock.advance(2000);
    room.apply({ action: 'seek', position: 300 });
    clock.advance(3000);
    expect(hostPlayer.position()).toBeGreaterThan(302);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.06);
    room.apply({ action: 'rate', rate: 1.5 });
    clock.advance(4000);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.1);
    room.apply({ action: 'pause' });
    clock.advance(500);
    expect(guestPlayer.isPlaying()).toBe(false);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.26);
  });

  it('lets a guest pause and play for the group', () => {
    const { clock, follower, hostPlayer, guestPlayer } = setup();
    follower.attach(guestPlayer, false);
    clock.advance(2000);
    expect(follower.request({ action: 'pause' })).toBe(true);
    clock.advance(300);
    expect(hostPlayer.isPlaying()).toBe(false);
    expect(guestPlayer.isPlaying()).toBe(false);
    follower.request({ action: 'play' });
    clock.advance(2000);
    expect(hostPlayer.isPlaying()).toBe(true);
    expect(guestPlayer.isPlaying()).toBe(true);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.06);
  });

  it('refuses guest controls when only the host controls', () => {
    const { clock, room, follower, hostPlayer, guestPlayer, denied } = setup();
    follower.attach(guestPlayer, false);
    clock.advance(1000);
    room.setOnlyHostControls(true);
    // Member and policy changes go out after at most MEMBERS_EVERY (250 ms).
    clock.advance(300);
    expect(follower.onlyHostControls).toBe(true);
    expect(follower.request({ action: 'pause' })).toBe(false);
    expect(denied).toEqual(['Only the host controls playback.']);
    clock.advance(500);
    expect(hostPlayer.isPlaying()).toBe(true);
  });

  it('waits while a guest buffers and goes on together', () => {
    const { clock, room, follower, hostPlayer, guestPlayer } = setup();
    follower.attach(guestPlayer, false);
    clock.advance(2000);
    guestPlayer.setBuffering(true);
    clock.advance(500);
    expect(room.state.waiting).toBe(true);
    expect(hostPlayer.isPlaying()).toBe(false);
    clock.advance(2000);
    guestPlayer.setBuffering(false);
    clock.advance(1500);
    expect(room.state.waiting).toBe(false);
    expect(hostPlayer.isPlaying()).toBe(true);
    expect(gap(hostPlayer, guestPlayer)).toBeLessThan(0.06);
  });

  it('removes a guest that leaves and stops waiting for it', () => {
    const { clock, room, follower, hostPlayer } = setup({ hostPaused: true });
    room.apply({ action: 'play' });
    clock.advance(100);
    expect(room.state.waiting).toBe(true);
    follower.leave();
    clock.advance(100);
    expect(room.memberList).toEqual([]);
    expect(room.state.waiting).toBe(false);
    clock.advance(500);
    expect(hostPlayer.isPlaying()).toBe(true);
  });
});

describe('AnchorFollower attach', () => {
  it('lets a reloaded player take its real play state, then plays it with the group', () => {
    const clock = new VirtualClock();
    const p = new FakePlayer(clock);
    const resync = jest.fn();
    const port = Object.assign(p, { resync });
    const f = new AnchorFollower({ now: () => clock.t, remoteNow: () => clock.t, timers: clock });
    f.setAnchor({ playing: true, rate: 1, hostTime: clock.t, position: 5 });
    f.attach(port);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(p.isPlaying()).toBe(true);
  });
});

describe('Follower ping pace', () => {
  /** A guest whose pings a host answers after `rtt` ms (half each way). Counts the pings. */
  function pinger(rtt: () => number) {
    const clock = new VirtualClock();
    const pings: number[] = [];
    let f: Follower;
    f = new Follower({
      send: (m) => {
        if (m.t !== 'ping') return;
        pings.push(clock.t);
        const d = rtt();
        clock.setTimeout(() => f.receive({ t: 'pong', id: m.id, t0: m.t0, t1: clock.t + 500, t2: clock.t + 500 }, clock.t + d / 2), d / 2);
      },
      now: () => clock.t,
      timers: clock,
    });
    f.start('Phone', []);
    return { clock, pings, f: () => f };
  }
  const between = (pings: number[], a: number, b: number) => pings.filter((t) => t >= a && t < b).length;

  it('pings every 2 s until the clock converges, then every 10 s', () => {
    const { clock, pings, f } = pinger(() => 10);
    clock.advance(60_000);
    // The start burst (8) and 2 s pings until 12 samples agree.
    expect(between(pings, 0, 1000)).toBe(8);
    expect(f().pingEvery).toBe(10_000);
    expect(between(pings, 30_000, 60_000)).toBe(3);
  });

  it('pings fast again after a relink, and after a round trip jump', () => {
    let rtt = 10;
    const { clock, pings, f } = pinger(() => rtt);
    clock.advance(60_000);
    f().relink(() => undefined, false);
    expect(f().pingEvery).toBe(2000);
    // The relink's link sends nothing: the next pings get no answer, the pace stays fast for 8 pings.
    clock.advance(20_000);
    expect(f().pingEvery).toBe(10_000);
    void pings;
    const g = pinger(() => rtt);
    g.clock.advance(60_000);
    rtt = 300;
    g.clock.advance(12_000);
    expect(g.f().pingEvery).toBe(2000);
  });
});

describe('HostRoom pong', () => {
  it('lets the link stamp the pong when it can', () => {
    const clock = new VirtualClock();
    const pong = jest.fn();
    const send = jest.fn();
    const room = new HostRoom({ send, now: () => clock.t, player: new FakePlayer(clock), timers: clock, pong }, { sessionId: 's', item, stream: null, onlyHostControls: false });
    room.receive('g', { t: 'ping', id: 7, t0: 1.5 }, 40);
    expect(pong).toHaveBeenCalledWith('g', 7, 1.5, 40);
    expect(send).not.toHaveBeenCalled();
  });
});
