import { joinTransport, mergeSessions, playForEveryone, roomLabel, sessionHeadline, whoCanJoin } from '../hub';
import { decode, encode, type Message } from '../protocol';
import { HostRoom } from '../room';
import { initialTogether, type NearbyHost } from '../store';
import { FakePlayer, VirtualClock } from '../test-utils/sim';

const server = { serverId: 'S1', serverName: 'Home server' };
const host = (peerId: string, hostName: string, itemName: string, serverId: string | null = 'S1'): NearbyHost => ({
  peerId,
  via: 'network',
  advert: { sessionId: `s-${peerId}`, hostName, itemId: 'i1', itemName, serverId, kind: 'video' },
});

describe('mergeSessions', () => {
  it('lists nearby hosts and server groups in one list, with plain tags', () => {
    const rows = mergeSessions([host('n1', 'Sam · iPhone', 'Film')], [{ id: 'g1', name: "Jane's group", state: 'Playing', participants: ['Jane'] }], server);
    expect(rows.map((r) => [r.hostName, r.title, r.tag])).toEqual([
      ['Sam · iPhone', 'Film', 'Nearby'],
      ["Jane's group", 'Playing · Jane', 'On Home server'],
    ]);
  });

  it('shows a nearby host and its own server group as one row, joined nearby', () => {
    const rows = mergeSessions([host('n1', 'Sam · iPhone', 'Film')], [{ id: 'g1', name: "Sam's group", state: 'Playing', participants: ['Sam'] }], server);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tag: 'Nearby', peerId: 'n1', groupId: 'g1' });
    expect(joinTransport(rows[0]!)).toBe('nearby');
  });

  it('does not merge a group from another server', () => {
    const rows = mergeSessions([host('n1', 'Sam · iPhone', 'Film', 'S2')], [{ id: 'g1', name: "Sam's group", state: 'Idle', participants: [] }], server);
    expect(rows).toHaveLength(2);
    expect(joinTransport(rows[1]!)).toBe('server');
  });
});

describe('whoCanJoin', () => {
  const base = { nearbyOn: true, signedIn: true, offline: false, serverName: 'Home server', onServer: true, downloaded: false };

  it('defaults to the server for a streamed item, and says that nearby guests need access', () => {
    const w = whoCanJoin(base);
    expect(w.initial).toBe('server');
    expect(w.options.map((o) => o.title)).toEqual(['People near you', 'Anyone on Home server']);
    expect(w.options[0]!.detail).toContain('Each guest needs the download, or a sign-in to Home server');
  });

  it('defaults to people near you for a download or when offline', () => {
    expect(whoCanJoin({ ...base, downloaded: true }).initial).toBe('nearby');
    const off = whoCanJoin({ ...base, offline: true, downloaded: true });
    expect(off.initial).toBe('nearby');
    expect(off.options.map((o) => o.id)).toEqual(['nearby']);
  });

  it('offers the server only when signed in and the item is on it', () => {
    expect(whoCanJoin({ ...base, signedIn: false }).options.map((o) => o.id)).toEqual(['nearby']);
    expect(whoCanJoin({ ...base, onServer: false }).options.map((o) => o.id)).toEqual(['nearby']);
  });

  it('the web (no nearby) offers the server only', () => {
    const w = whoCanJoin({ ...base, nearbyOn: false });
    expect(w.options.map((o) => o.id)).toEqual(['server']);
    expect(w.initial).toBe('server');
  });

  it('never shows the transport names', () => {
    const text = JSON.stringify(whoCanJoin(base));
    expect(text).not.toMatch(/SyncPlay|LAN|Bonjour/);
  });
});

describe('sessionHeadline', () => {
  it('says where the session runs, in plain words', () => {
    expect(sessionHeadline({ ...initialTogether, mode: 'nearby', role: 'host', members: [] }, null)).toBe('Nearby · 1 person');
    const two = [{ id: 'a', name: 'A', local: false, buffering: false, joinedAt: 0 }];
    expect(sessionHeadline({ ...initialTogether, mode: 'nearby', role: 'host', members: two }, null)).toBe('Nearby · 2 people');
    expect(sessionHeadline({ ...initialTogether, syncplay: { ...initialTogether.syncplay, group: { id: 'g', name: 'G', state: 'Idle', participants: [] } } }, 'Home server')).toBe(
      'On Home server · from anywhere',
    );
  });
});

describe('HostRoom.expel', () => {
  it('tells the member why, and drops it from the list at once', () => {
    const clock = new VirtualClock();
    const sent: { m: Message; to?: string[] }[] = [];
    const room = new HostRoom(
      { send: (m, to) => sent.push({ m: decode(encode(m))!, to }), now: () => clock.t, player: new FakePlayer(clock, 50), timers: clock },
      { sessionId: 's1', item: { id: 'i', name: 'Film', type: 'Movie' }, stream: null, onlyHostControls: false },
    );
    room.receive('peer1', { t: 'hello', name: 'Sam', have: [], memberId: 'm1' }, clock.t);
    expect(room.memberList.map((m) => m.id)).toEqual(['m1']);
    expect(room.expel('m1', 'The host removed you from the session.')).toBe('peer1');
    expect(room.memberList).toEqual([]);
    expect(sent.some((x) => x.m.t === 'removed' && x.to?.[0] === 'peer1')).toBe(true);
  });
});

describe('rooms in the hub', () => {
  const base = { ...initialTogether, mode: 'nearby' as const };

  it('the room bar says what plays, or who picks', () => {
    expect(roomLabel(initialTogether)).toBeNull();
    expect(roomLabel({ ...base, role: 'host', phase: { name: 'hosting', sessionId: 's' }, members: [] })).toBe('Together · 1 person · Pick something to play');
    const two = [
      { id: 'a', name: 'Sam · iPad', local: false },
      { id: 'b', name: 'Kim · Pixel', local: false },
    ];
    expect(roomLabel({ ...base, role: 'host', phase: { name: 'hosting', sessionId: 's' }, members: two, item: { id: 'f', name: 'Dune', type: 'Movie' } })).toBe('Together · Dune · 3 people');
    expect(roomLabel({ ...base, role: 'guest', phase: { name: 'joined', hostPeerId: 'p', hostName: 'Sam · iPhone', sessionId: 's' }, hostName: 'Sam · iPhone' })).toBe(
      'Together · Waiting for Sam to pick something',
    );
    expect(roomLabel({ ...base, role: 'host', phase: { name: 'hosting', sessionId: 's' }, requests: [{ inviteId: 'i', peerId: 'p', name: 'Kim · Pixel', have: false }] })).toBe(
      'Together · Kim wants to join',
    );
    // Audio: the album, not the track.
    expect(roomLabel({ ...base, role: 'host', phase: { name: 'hosting', sessionId: 's' }, item: { id: 't', name: 'Song', type: 'Audio', album: 'Blue' } })).toBe('Together · Blue · 1 person');
  });

  it('a SyncPlay room bar shows no count while the count is not known', () => {
    const group = { id: 'g', name: 'G', state: 'Idle', participants: ['Sam', 'Kim'] };
    const sp = (g: typeof group & { stale?: boolean }, item: { id: string; name: string; type: string } | null = null) =>
      roomLabel({ ...initialTogether, mode: 'syncplay', item, syncplay: { ...initialTogether.syncplay, group: g } });
    expect(sp(group)).toBe('Together · 2 people · Pick something to play');
    expect(sp({ ...group, stale: true })).toBe('Together · Pick something to play');
    expect(sp({ ...group, participants: [] }, { id: 'f', name: 'Dune', type: 'Movie' })).toBe('Together · Dune');
    expect(sp(group, { id: 'f', name: 'Dune', type: 'Movie' })).toBe('Together · Dune · 2 people');
  });

  it('item pages: Play for everyone, or only the host picks', () => {
    expect(playForEveryone(initialTogether)).toBeNull();
    expect(playForEveryone({ ...base, role: 'host', phase: { name: 'hosting', sessionId: 's' } })).toEqual({ label: 'Play for everyone', locked: false });
    const joined = { name: 'joined' as const, hostPeerId: 'p', hostName: 'Sam', sessionId: 's' };
    expect(playForEveryone({ ...base, role: 'guest', phase: joined, onlyHostControls: false })).toEqual({ label: 'Play for everyone', locked: false });
    expect(playForEveryone({ ...base, role: 'guest', phase: joined, onlyHostControls: true })).toEqual({ label: 'Only the host picks', locked: true });
  });

  it('an empty room offers both transports and starts nearby', () => {
    const w = whoCanJoin({ nearbyOn: true, signedIn: true, offline: false, serverName: 'Home', onServer: true, downloaded: false, room: true });
    expect(w.options.map((o) => o.id)).toEqual(['nearby', 'server']);
    expect(w.initial).toBe('nearby');
  });
});
