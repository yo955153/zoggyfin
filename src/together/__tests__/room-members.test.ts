import { Follower } from '../follower';
import { decode, encode, type Message } from '../protocol';
import { HostRoom, MEMBERS_EVERY } from '../room';
import { FakePlayer, VirtualClock } from '../test-utils/sim';

const item = { id: 'item1', name: 'Film', type: 'Movie' };

function host() {
  const clock = new VirtualClock();
  const sent: { m: Message; to: string[] | undefined; bytes: number }[] = [];
  const room = new HostRoom(
    { send: (m, to) => sent.push({ m, to, bytes: encode(m).length }), now: () => clock.t, player: new FakePlayer(clock), timers: clock },
    { sessionId: 's', item, stream: null, onlyHostControls: false },
  );
  const hello = (peer: string, deltas = true) => room.receive(peer, { t: 'hello', name: `Guest ${peer}`, have: [], memberId: peer, ...(deltas ? { deltas: true } : {}) }, clock.t);
  const of = (t: Message['t']) => sent.filter((x) => x.m.t === t);
  return { clock, room, sent, hello, of };
}

describe('HostRoom members', () => {
  it('merges the changes of 250 ms into one delta', () => {
    const h = host();
    for (let i = 0; i < 16; i++) h.hello(`g${i}`);
    expect(h.of('memberDelta')).toHaveLength(0);
    h.clock.advance(MEMBERS_EVERY);
    const deltas = h.of('memberDelta');
    expect(deltas).toHaveLength(1);
    expect((deltas[0].m as Extract<Message, { t: 'memberDelta' }>).upsert).toHaveLength(16);
    expect(deltas[0].to).toHaveLength(16);
  });

  it('a join storm costs a few KB, not O(N³)', () => {
    const h = host();
    // 16 guests join one by one, 100 ms apart, and each reports its player once.
    for (let i = 0; i < 16; i++) {
      h.hello(`g${i}`);
      h.clock.advance(50);
      h.room.receive(`g${i}`, { t: 'buffering', buffering: false, local: true }, h.clock.t);
      h.clock.advance(50);
    }
    h.clock.advance(1000);
    const bytes = [...h.of('memberDelta'), ...h.of('welcome')].reduce((a, x) => a + x.bytes * (x.to?.length ?? 1), 0);
    // The full-list protocol sent about 165 B x N^2 per event, two events per join: about 1.4 MB here.
    expect(bytes).toBeLessThan(80_000);
  });

  it('leaves buffering out: a guest that stalls changes no list', () => {
    const h = host();
    h.hello('a');
    h.hello('b');
    h.clock.advance(MEMBERS_EVERY);
    const before = h.of('memberDelta').length;
    h.room.receive('a', { t: 'buffering', buffering: true, local: false }, h.clock.t);
    h.room.receive('a', { t: 'buffering', buffering: false, local: false }, h.clock.t);
    h.clock.advance(MEMBERS_EVERY * 4);
    expect(h.of('memberDelta').length).toBe(before);
    for (const d of h.of('memberDelta')) for (const m of (d.m as Extract<Message, { t: 'memberDelta' }>).upsert) expect(m.buffering).toBeUndefined();
    // The host still knows it.
    h.room.receive('a', { t: 'buffering', buffering: true, local: false }, h.clock.t);
    expect(h.room.memberList.find((m) => m.id === 'a')?.buffering).toBe(true);
  });

  it('gives a new guest the whole list in its welcome', () => {
    const h = host();
    h.hello('a');
    h.clock.advance(MEMBERS_EVERY);
    h.hello('b');
    const w = h.of('welcome').at(-1)!.m as Extract<Message, { t: 'welcome' }>;
    expect(w.members?.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('sends an older guest the whole list, with buffering, at the same pace', () => {
    const h = host();
    h.hello('old', false);
    h.hello('new');
    h.clock.advance(MEMBERS_EVERY);
    const full = h.of('members');
    expect(full).toHaveLength(1);
    expect(full[0].to).toEqual(['old']);
    const list = (full[0].m as Extract<Message, { t: 'members' }>).members;
    expect(list.every((m) => m.buffering === false)).toBe(true);
    // An older guest's decoder needs `buffering`: the list passes it.
    expect(decode(encode(full[0].m))).not.toBeNull();
    expect(h.of('memberDelta')[0].to).toEqual(['new']);
    expect((h.of('welcome').find((x) => x.to?.[0] === 'old')!.m as Extract<Message, { t: 'welcome' }>).members).toBeUndefined();
  });

  it('tells the guests who left', () => {
    const h = host();
    h.hello('a');
    h.hello('b');
    h.clock.advance(MEMBERS_EVERY);
    h.room.receive('b', { t: 'leave' }, h.clock.t);
    h.clock.advance(MEMBERS_EVERY);
    const d = h.of('memberDelta').at(-1)!;
    expect(d.m).toMatchObject({ t: 'memberDelta', upsert: [], gone: ['b'] });
    expect(d.to).toEqual(['a']);
  });
});

describe('Follower members', () => {
  it('keeps the list from the welcome and the deltas', () => {
    const clock = new VirtualClock();
    const f = new Follower({ send: () => undefined, now: () => clock.t, timers: clock });
    const anchor = { playing: false, rate: 1, hostTime: 0, position: 0 };
    const m = (id: string) => ({ id, name: id, local: false });
    f.receive({ t: 'welcome', sessionId: 's', item, stream: null, onlyHostControls: false, anchor, you: 'me', members: [m('me'), m('a')] }, 0);
    expect(f.members.map((x) => x.id)).toEqual(['a']);
    f.receive({ t: 'memberDelta', upsert: [m('b'), { ...m('a'), away: true }], gone: [], onlyHostControls: true }, 0);
    expect(f.members).toEqual([{ ...m('a'), away: true }, m('b')]);
    expect(f.onlyHostControls).toBe(true);
    f.receive({ t: 'memberDelta', upsert: [], gone: ['a'], onlyHostControls: true }, 0);
    expect(f.allMembers.map((x) => x.id)).toEqual(['me', 'b']);
  });

  it('says it takes deltas in its hello', () => {
    const clock = new VirtualClock();
    const sent: Message[] = [];
    const f = new Follower({ send: (x) => sent.push(x), now: () => clock.t, timers: clock });
    f.start('Phone', []);
    expect(sent[0]).toMatchObject({ t: 'hello', deltas: true });
    f.dispose();
  });
});
