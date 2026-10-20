/**
 * Rooms: a session with no item, then one item after another, video and
 * audio, with a guest of this build (it sends `rooms`) and a guest of an
 * older build (no `rooms`). Host and guest talk over a simulated link with
 * the real wire format (encode → decode).
 */
import { Follower } from '../follower';
import { decode, encode, type Message, type SharedQueue } from '../protocol';
import { HostRoom, LOAD_LIMIT, ONLY_HOST_PICKS, type RoomMedia, type RoomQueue, UPDATE_TEXT } from '../room';
import { FakePlayer, VirtualClock } from '../test-utils/sim';

const film = { id: 'film1', name: 'Dune', type: 'Movie', path: '/t/1.mp4' };
const film2 = { id: 'film2', name: 'Arrival', type: 'Movie', path: '/t/2.mp4' };
const track = { id: 'tr1', name: 'Song', type: 'Audio', album: 'Album', path: '/t/3.m4a' };

const wire = (m: Message) => decode(encode(m))!;

function fakeQueue(): RoomQueue {
  const q: SharedQueue = { entries: [{ key: 'k1', item: track }], index: 0, shuffle: false, repeat: 'off', longForm: false };
  return { snapshot: () => q, track: () => 'k1', onTrack: () => () => undefined, onQueue: () => () => undefined, apply: () => undefined };
}

/** A room with no item and one guest of this build. */
function setup(opts: { onlyHostControls?: boolean } = {}) {
  const clock = new VirtualClock();
  const hostNow = () => clock.t + 50_000;
  const guestNow = () => clock.t + 1_000;
  const toGuest: Message[] = [];
  const toHost: Message[] = [];
  const picks: { id: string; name: string; title: string }[] = [];
  const dropped: string[] = [];
  const media: Extract<Message, { t: 'media' }>[] = [];
  let follower: Follower;
  const room = new HostRoom(
    {
      send: (m, to) => {
        if (to && !to.includes('g')) return;
        toGuest.push(m);
        clock.setTimeout(() => follower.receive(wire(m), guestNow()), 10);
      },
      now: hostNow,
      player: new FakePlayer(clock),
      timers: clock,
      onPick: (id, name, p) => picks.push({ id, name, title: p.item.name }),
      drop: (peer) => dropped.push(peer),
    },
    { sessionId: 's1', item: null, stream: null, onlyHostControls: opts.onlyHostControls ?? false },
  );
  follower = new Follower({
    send: (m) => {
      toHost.push(m);
      clock.setTimeout(() => room.receive('g', wire(m), hostNow()), 10);
    },
    now: guestNow,
    timers: clock,
    onMedia: (m) => media.push(m),
  });
  follower.start('Sam · iPad', [], { memberId: 'g' });
  clock.advance(1500);
  /** The host plays something new: a video file, or audio with a queue. */
  const play = (item: typeof film | typeof track, kind: 'video' | 'audio' = 'video', by?: string) => {
    const player = new FakePlayer(clock, 50);
    const m: RoomMedia = { kind, item, stream: { service: 'zgf-1', path: item.path }, player, ...(kind === 'audio' ? { queue: fakeQueue() } : {}) };
    room.setMedia(m, { by });
    return player;
  };
  return { clock, room, follower, toGuest, toHost, picks, dropped, media, play, hostNow };
}

describe('room: empty → item → new item → kind change → end', () => {
  it('a guest joins a room with no item and waits', () => {
    const { room, follower, toGuest, media } = setup();
    const welcome = toGuest.find((m) => m.t === 'welcome') as Extract<Message, { t: 'welcome' }>;
    expect(welcome.item).toBeNull();
    expect(welcome.media).toBe(0);
    expect(room.hasMedia).toBe(false);
    // Nothing to load: the guest does not hold the group.
    expect(room.memberList).toMatchObject([{ id: 'g', buffering: false }]);
    expect(follower.media).toBe(0);
    expect(media).toHaveLength(0);
  });

  it('the first item: the guest loads it, the group starts when the guest is ready', () => {
    const { clock, room, follower, media, play } = setup();
    const host = play(film);
    clock.advance(100);
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ kind: 'video', item: { id: 'film1' }, media: 1 });
    // The guest loads: the group waits for it.
    expect(room.state.waiting).toBe(true);
    expect(host.isPlaying()).toBe(false);
    const guest = new FakePlayer(clock, 80);
    follower.attach(guest, false);
    clock.advance(1000);
    expect(room.state.waiting).toBe(false);
    expect(host.isPlaying()).toBe(true);
    expect(guest.isPlaying()).toBe(true);
    clock.advance(5000);
    expect(Math.abs(host.position() - guest.position())).toBeLessThan(0.06);
  });

  it('a new item while one plays: everyone switches, and an old ready report does not start the group', () => {
    const { clock, room, follower, toHost, media, play } = setup();
    play(film);
    clock.advance(100);
    follower.attach(new FakePlayer(clock, 80), false);
    clock.advance(3000);
    const host2 = play(film2);
    // A late report for the old item arrives after the switch.
    room.receive('g', { t: 'buffering', buffering: false, local: false, media: 1 }, 0);
    clock.advance(100);
    expect(media.map((m) => m.item?.id)).toEqual(['film1', 'film2']);
    expect(room.state.waiting).toBe(true);
    expect(host2.isPlaying()).toBe(false);
    // The guest's reports carry the item number.
    const guest2 = new FakePlayer(clock, 80);
    follower.attach(guest2, false);
    clock.advance(1000);
    expect(toHost.filter((m) => m.t === 'buffering').at(-1)).toMatchObject({ media: 2 });
    expect(host2.isPlaying()).toBe(true);
    expect(guest2.isPlaying()).toBe(true);
  });

  it('video to audio: the room kind follows the item, with the queue', () => {
    const { clock, room, follower, media, play } = setup();
    play(film);
    clock.advance(100);
    follower.attach(new FakePlayer(clock), false);
    clock.advance(1000);
    play(track, 'audio');
    clock.advance(100);
    expect(room.kind).toBe('audio');
    expect(media.at(-1)).toMatchObject({ kind: 'audio', track: 'k1', queue: { entries: [{ key: 'k1' }] } });
    expect(follower.facts?.kind).toBe('audio');
    expect(follower.queue?.entries[0]?.key).toBe('k1');
  });

  it('back to no item: the guest gets a media message with no item, and nobody waits', () => {
    const { clock, room, media, play } = setup();
    play(film);
    clock.advance(100);
    room.setMedia(null);
    clock.advance(100);
    expect(media.at(-1)).toMatchObject({ item: null });
    expect(room.hasMedia).toBe(false);
    expect(room.state.waiting).toBe(false);
    expect(room.memberList[0]?.buffering).toBe(false);
  });

  it('end: the guest hears that the session is over', () => {
    const { clock, room, toGuest, play } = setup();
    play(film);
    room.end();
    clock.advance(100);
    expect(toGuest.at(-1)).toEqual({ t: 'end' });
  });

  it('a guest that cannot load the item does not hold the group', () => {
    const { clock, room, follower, play } = setup();
    const host = play(film);
    clock.advance(100);
    follower.cannotPlay();
    clock.advance(1000);
    expect(room.state.waiting).toBe(false);
    expect(host.isPlaying()).toBe(true);
    expect(room.memberList[0]).toMatchObject({ noMedia: true, buffering: false });
  });

  it('a guest that never finishes loading holds the group for at most LOAD_LIMIT', () => {
    const { clock, room, play } = setup();
    const host = play(film);
    clock.advance(LOAD_LIMIT - 1000);
    expect(host.isPlaying()).toBe(false);
    clock.advance(2000);
    expect(room.state.waiting).toBe(false);
    expect(host.isPlaying()).toBe(true);
  });

  it('a suspended room (the host loads something) pauses the guests', () => {
    const { clock, room, follower, play } = setup();
    play(film);
    clock.advance(100);
    const guest = new FakePlayer(clock);
    follower.attach(guest, false);
    clock.advance(2000);
    expect(guest.isPlaying()).toBe(true);
    room.suspend();
    clock.advance(500);
    expect(guest.isPlaying()).toBe(false);
  });
});

describe('room: a late joiner', () => {
  it('joins mid-item: it gets the item and the playing anchor, and the group does not wait', () => {
    const clock = new VirtualClock();
    const host = new FakePlayer(clock);
    const sent: Message[] = [];
    const room = new HostRoom({ send: (m) => sent.push(m), now: () => clock.t, player: host, timers: clock }, { sessionId: 's', item: null, stream: null, onlyHostControls: false });
    room.setMedia({ kind: 'video', item: film, stream: null, player: host });
    clock.advance(1000);
    expect(host.isPlaying()).toBe(true);
    clock.advance(30_000);
    room.receive('late', { t: 'hello', name: 'Late', have: [], memberId: 'late', deltas: true, rooms: true }, clock.t);
    const welcome = sent.findLast((m) => m.t === 'welcome') as Extract<Message, { t: 'welcome' }>;
    expect(welcome.item?.id).toBe('film1');
    expect(welcome.media).toBe(1);
    expect(welcome.anchor.playing).toBe(true);
    expect(welcome.anchor.position).toBeGreaterThan(29);
    // It loads, but the group plays on: it catches up.
    expect(room.state.waiting).toBe(false);
    expect(host.isPlaying()).toBe(true);
  });
});

describe('room: a guest of an older build', () => {
  function oldGuest(item: typeof film | null) {
    const clock = new VirtualClock();
    const sent: { m: Message; to?: string[] }[] = [];
    const dropped: string[] = [];
    const host = new FakePlayer(clock);
    const room = new HostRoom(
      { send: (m, to) => sent.push({ m, to }), now: () => clock.t, player: host, timers: clock, drop: (p) => dropped.push(p) },
      { sessionId: 's', item, stream: null, onlyHostControls: false },
    );
    // Build 9 sends no `rooms`.
    room.receive('old', { t: 'hello', name: 'Old', have: [], memberId: 'old', deltas: true }, clock.t);
    return { clock, room, sent, dropped, host };
  }

  it('cannot wait in a room with no item: it is told to update', () => {
    const { room, sent, dropped } = oldGuest(null);
    expect(sent).toEqual([{ m: { t: 'removed', reason: UPDATE_TEXT.empty }, to: ['old'] }]);
    expect(dropped).toEqual(['old']);
    expect(room.memberList).toHaveLength(0);
  });

  it('joins a room that plays an item, and is removed with a reason when the item changes', () => {
    const { clock, room, sent, dropped } = oldGuest(film);
    expect(sent.find((x) => x.m.t === 'welcome')?.m).toMatchObject({ item: { id: 'film1' } });
    expect((sent.find((x) => x.m.t === 'welcome')?.m as { media?: number }).media).toBeUndefined();
    expect(room.memberList).toHaveLength(1);
    room.setMedia({ kind: 'video', item: film2, stream: null, player: new FakePlayer(clock) });
    expect(sent.find((x) => x.m.t === 'removed')).toEqual({ m: { t: 'removed', reason: UPDATE_TEXT.changed }, to: ['old'] });
    expect(sent.some((x) => x.m.t === 'media')).toBe(false);
    expect(dropped).toEqual(['old']);
    expect(room.memberList).toHaveLength(0);
  });
});

describe('room: a guest picks something', () => {
  it('with "Only I control" off, the pick goes to the host with the guest', () => {
    const { clock, follower, picks } = setup({ onlyHostControls: false });
    expect(follower.pick({ item: { id: 'film2', name: 'Arrival', type: 'Movie' } })).toBe(true);
    clock.advance(100);
    expect(picks).toEqual([{ id: 'g', name: 'Sam · iPad', title: 'Arrival' }]);
  });

  it('with "Only I control" on, the host says no and does not play it', () => {
    const { clock, room, toGuest, picks } = setup({ onlyHostControls: true });
    // Even a guest that did not know the rule yet: the host checks it.
    room.receive('g', { t: 'pick', pick: { item: { id: 'film2', name: 'Arrival', type: 'Movie' } } }, 0);
    clock.advance(100);
    expect(picks).toHaveLength(0);
    expect(toGuest.at(-1)).toEqual({ t: 'denied', reason: ONLY_HOST_PICKS });
  });

  it('a guest that knows "Only I control" is on does not send the pick', () => {
    const denied: string[] = [];
    const clock = new VirtualClock();
    const sent: Message[] = [];
    const f = new Follower({ send: (m) => sent.push(m), now: () => clock.t, timers: clock, onDenied: (r) => denied.push(r) });
    f.receive({ t: 'members', members: [], onlyHostControls: true }, 0);
    expect(f.pick({ item: { id: 'x', name: 'X', type: 'Movie' } })).toBe(false);
    expect(sent.some((m) => m.t === 'pick')).toBe(false);
    expect(denied).toEqual([ONLY_HOST_PICKS]);
  });

  it('the picker is named in the media message', () => {
    const { clock, media, play } = setup();
    play(film2, 'video', 'g');
    clock.advance(100);
    expect(media[0]?.by).toBe('g');
  });
});

describe('room messages on the wire', () => {
  it('decodes media, pick and a welcome with no item', () => {
    const m: Message = { t: 'media', seq: 3, media: 2, kind: 'video', item: film, stream: null, anchor: { playing: false, rate: 1, hostTime: 1, position: 0 } };
    expect(decode(encode(m))).toEqual(m);
    const p: Message = { t: 'pick', pick: { item: { id: 'a', name: 'A', type: 'MusicAlbum' }, list: [{ id: 't', name: 'T', type: 'Audio', mediaType: 'Audio' }], index: 0 } };
    expect(decode(encode(p))).toEqual(p);
    const w: Message = { t: 'welcome', sessionId: 's', item: null, stream: null, onlyHostControls: false, anchor: { playing: false, rate: 1, hostTime: 1, position: 0 }, media: 0 };
    expect(decode(encode(w))).toEqual(w);
  });

  it('drops a pick with a bad shape', () => {
    expect(decode(JSON.stringify({ v: 1, t: 'pick', pick: { item: { id: '', name: 'A', type: 'Movie' } } }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'pick', pick: { item: { id: 'a', name: 'A', type: 'Movie' }, index: -1 } }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'pick', pick: { item: { id: 'a', name: 'A', type: 'Movie' }, list: new Array(301).fill({ id: 'a', name: 'A', type: 'Audio' }) } }))).toBeNull();
  });
});
