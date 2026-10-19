import { IDLE, inSession, type Phase, transition } from '../machine';
import {
  decode,
  decodeAdvert,
  decodeJoinContext,
  encode,
  encodeAdvert,
  encodeJoinContext,
  type Message,
  PROTOCOL_VERSION,
} from '../protocol';

const anchor = { playing: true, rate: 1, hostTime: 1234.5, position: 61.25 };

const samples: Message[] = [
  { t: 'hello', name: 'iPad', have: ['a', 'b'] },
  {
    t: 'welcome',
    sessionId: 's1',
    item: { id: 'item1', name: 'Movie', type: 'Movie', runTimeTicks: 10, mediaSourceId: 'm', container: 'mp4' },
    stream: { service: 'zgf-a1', path: '/tok/media.mp4' },
    onlyHostControls: false,
    anchor,
  },
  { t: 'welcome', sessionId: 's1', item: { id: 'i', name: 'n', type: 'Episode' }, stream: null, onlyHostControls: true, anchor },
  { t: 'ping', id: 1, t0: 10.5 },
  { t: 'pong', id: 1, t0: 10.5, t1: 20, t2: 21 },
  { t: 'state', seq: 3, anchor, waiting: false },
  { t: 'control', action: 'play' },
  { t: 'control', action: 'pause', position: 12 },
  { t: 'control', action: 'seek', position: 300 },
  { t: 'control', action: 'rate', rate: 1.5 },
  { t: 'buffering', buffering: true, local: false },
  { t: 'members', members: [{ id: 'p', name: 'Sam', local: true, buffering: false }], onlyHostControls: false },
  { t: 'denied', reason: 'no' },
  { t: 'end' },
  { t: 'leave' },
];

describe('protocol', () => {
  it.each(samples.map((m) => [m.t, m]))('round-trips %s', (_t, m) => {
    const text = encode(m as Message);
    expect(JSON.parse(text).v).toBe(PROTOCOL_VERSION);
    expect(decode(text)).toEqual(m);
  });

  it('drops other versions, unknown types and bad shapes', () => {
    expect(decode(JSON.stringify({ v: 2, t: 'end' }))).toBeNull();
    expect(decode(JSON.stringify({ t: 'end' }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'dance' }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'ping', id: '1', t0: 0 }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'control', action: 'seek', position: -3 }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'control', action: 'rate', rate: 99 }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'state', seq: 1, anchor: { ...anchor, rate: 0 }, waiting: false }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'welcome', sessionId: 's', item: { id: '' }, stream: null, onlyHostControls: false, anchor }))).toBeNull();
    expect(decode('not json')).toBeNull();
    expect(decode('[1,2]')).toBeNull();
  });

  it('encodes the join context and the advert', () => {
    expect(decodeJoinContext(encodeJoinContext({ name: 'iPhone', have: true }))).toEqual({ v: 1, name: 'iPhone', have: true });
    expect(decodeJoinContext('{"v":9,"name":"x","have":true}')).toBeNull();
    expect(decodeJoinContext(null)).toBeNull();
    const ad = encodeAdvert({ sessionId: 's1', hostName: 'H'.repeat(100), itemId: 'i1', itemName: 'Film', serverId: 'srv' });
    expect(ad.h).toHaveLength(60);
    expect(decodeAdvert(ad)).toEqual({ sessionId: 's1', hostName: 'H'.repeat(60), itemId: 'i1', itemName: 'Film', serverId: 'srv' });
    expect(decodeAdvert({ v: '1', s: 's', i: 'i' })?.serverId).toBeNull();
    expect(decodeAdvert({ v: '0', s: 's', i: 'i' })).toBeNull();
  });
});

describe('session machine', () => {
  const run = (events: Parameters<typeof transition>[1][], from: Phase = IDLE) => events.reduce(transition, from);

  it('hosts and ends', () => {
    const p = run([{ type: 'HOST', sessionId: 's' }]);
    expect(p).toEqual({ name: 'hosting', sessionId: 's' });
    expect(inSession(p)).toBe(true);
    expect(run([{ type: 'END' }], p)).toBe(IDLE);
  });

  it('joins: browse, request, connect, welcome', () => {
    const p = run([
      { type: 'BROWSE' },
      { type: 'REQUEST', hostPeerId: 'h', hostName: 'iPad' },
      { type: 'CONNECTED', peerId: 'h' },
      { type: 'WELCOME', sessionId: 's' },
    ]);
    expect(p).toEqual({ name: 'joined', hostPeerId: 'h', hostName: 'iPad', sessionId: 's' });
  });

  it('goes back to browsing when the host declines', () => {
    const p = run([{ type: 'BROWSE' }, { type: 'REQUEST', hostPeerId: 'h', hostName: 'iPad' }, { type: 'DISCONNECTED', peerId: 'h' }]);
    expect(p).toEqual({ name: 'browsing', notice: 'iPad did not let you join.' });
  });

  it('ends when the host ends or the link is lost', () => {
    const joined: Phase = { name: 'joined', hostPeerId: 'h', hostName: 'iPad', sessionId: 's' };
    expect(run([{ type: 'HOST_ENDED' }], joined)).toMatchObject({ name: 'ended', reason: 'host-ended' });
    expect(run([{ type: 'DISCONNECTED', peerId: 'h' }], joined)).toMatchObject({ name: 'ended', reason: 'lost' });
    expect(run([{ type: 'DISCONNECTED', peerId: 'other' }], joined)).toBe(joined);
  });

  it('ignores events that do not apply', () => {
    const hosting: Phase = { name: 'hosting', sessionId: 's' };
    expect(transition(hosting, { type: 'BROWSE' })).toBe(hosting);
    expect(transition(hosting, { type: 'WELCOME', sessionId: 'x' })).toBe(hosting);
    expect(transition(IDLE, { type: 'CONNECTED', peerId: 'h' })).toBe(IDLE);
    expect(transition(IDLE, { type: 'LEAVE' })).toBe(IDLE);
    expect(transition(hosting, { type: 'FAIL', message: 'x' })).toMatchObject({ name: 'ended', reason: 'error' });
    expect(transition({ name: 'ended', reason: 'lost', message: '' }, { type: 'RESET' })).toBe(IDLE);
  });
});
