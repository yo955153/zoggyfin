import { DEVICE_RATE, defaultFindable, deviceKey, isFinalRefusal, JoinGate, MAX_GUESTS, MAX_PENDING, REFUSAL_TEXT, REQUEST_TTL, TOTAL_RATE, visibleRequests } from '../join-gate';

function gate() {
  let t = 1_000_000;
  const g = new JoinGate(() => t);
  return { g, advance: (ms: number) => (t += ms), now: () => t };
}
const none = { guests: 0, pending: [] };

describe('JoinGate', () => {
  it('lets a first request through', () => {
    expect(gate().g.screen('m:a', none)).toBeNull();
  });

  it('refuses every request while the session is locked', () => {
    const { g } = gate();
    g.locked = true;
    expect(g.screen('m:a', none)).toBe('locked');
  });

  it(`caps a session at ${MAX_GUESTS} guests`, () => {
    const { g } = gate();
    expect(g.screen('m:a', { guests: MAX_GUESTS - 1, pending: [] })).toBeNull();
    expect(g.screen('m:b', { guests: MAX_GUESTS, pending: [] })).toBe('full');
  });

  it('allows one pending request per device', () => {
    const { g, now } = gate();
    const pending = [{ peerId: 's1', device: 'm:a', at: now() }];
    expect(g.screen('m:a', { guests: 0, pending })).toBe('duplicate');
    expect(g.screen('m:b', { guests: 0, pending })).toBeNull();
  });

  it('rate-limits each device', () => {
    const { g, advance } = gate();
    for (let i = 0; i < DEVICE_RATE.max; i++) {
      expect(g.screen('m:a', none)).toBeNull();
      advance(1000);
    }
    expect(g.screen('m:a', none)).toBe('rate');
    advance(DEVICE_RATE.windowMs);
    expect(g.screen('m:a', none)).toBeNull();
  });

  it('rate-limits all devices together (a flood of new peers)', () => {
    const { g } = gate();
    const results = Array.from({ length: TOTAL_RATE.max + 3 }, (_, i) => g.screen(`p:sock${i}`, none));
    expect(results.slice(0, TOTAL_RATE.max).every((r) => r === null)).toBe(true);
    expect(results.slice(TOTAL_RATE.max)).toEqual(['rate', 'rate', 'rate']);
  });

  it('refuses when too many requests wait', () => {
    const { g, now } = gate();
    const pending = Array.from({ length: MAX_PENDING }, (_, i) => ({ peerId: `s${i}`, device: `m:${i}`, at: now() }));
    expect(g.screen('m:new', { guests: 0, pending })).toBe('rate');
  });

  it('drops requests with no answer after 60 s', () => {
    const { g, now, advance } = gate();
    const pending = [
      { peerId: 's1', device: 'm:a', at: now() },
      { peerId: 's2', device: 'm:b', at: now() + 30_000 },
    ];
    advance(REQUEST_TTL);
    expect(g.expired(pending).map((p) => p.peerId)).toEqual(['s1']);
  });

  it('refuses a blocked device silently by its key, whatever its name or socket', () => {
    const { g } = gate();
    g.remove('m:a', true);
    expect(g.screen('m:a', none)).toBe('blocked');
    expect(g.screenReturn('m:a')).toBe('blocked');
    expect(g.screen('m:b', none)).toBeNull();
  });

  it('makes a removed (not blocked) device ask again, even with the session key', () => {
    const { g } = gate();
    expect(g.screenReturn('m:a')).toBeNull();
    g.remove('m:a', false);
    expect(g.screenReturn('m:a')).toBe('ask');
    g.locked = true;
    expect(g.screenReturn('m:a')).toBe('locked');
  });
});

describe('parts', () => {
  it('keys a device by member id, else by peer id', () => {
    expect(deviceKey('sock1', 'abc')).toBe('m:abc');
    expect(deviceKey('sock1', undefined)).toBe('p:sock1');
  });
  it('shows 3 requests and counts the rest', () => {
    expect(visibleRequests([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(visibleRequests([1])).toEqual({ shown: [1], more: 0 });
  });
  it('defaults to "Only with my code" on a network that looks public', () => {
    expect(defaultFindable({ networkType: 'wifi', hotspot: false })).toBe('anyone');
    expect(defaultFindable({ networkType: 'ethernet', hotspot: false })).toBe('anyone');
    expect(defaultFindable({ networkType: 'wifi', hotspot: true })).toBe('code');
    expect(defaultFindable({ networkType: 'cellular', hotspot: false })).toBe('code');
    expect(defaultFindable({ networkType: null, hotspot: false })).toBe('code');
  });
  it('knows which refusals end the guest’s tries', () => {
    expect(isFinalRefusal(REFUSAL_TEXT.removed)).toBe(true);
    expect(isFinalRefusal(REFUSAL_TEXT.full)).toBe(false);
  });
});
