import { DEVICE_KEY_TTL, MAX_DEVICE_KEYS, sessionDeviceKey } from '../device-key';
import { deviceKey, JoinGate } from '../join-gate';

function memStore() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), m };
}

let n = 0;
const random = () => `random-key-${String(++n).padStart(8, '0')}`;

describe('session device key', () => {
  it('stays the same for a session after a restart (the store keeps it)', () => {
    const store = memStore();
    const a = sessionDeviceKey('1a2b3c4d', random, { store });
    // A new launch: a new member id, but the same store.
    const b = sessionDeviceKey('1a2b3c4d', random, { store });
    expect(b).toBe(a);
  });

  it('is different for every session', () => {
    const store = memStore();
    expect(sessionDeviceKey('1a2b3c4d', random, { store })).not.toBe(sessionDeviceKey('99887766', random, { store }));
  });

  it('forgets old sessions and keeps at most a fixed number', () => {
    const store = memStore();
    let t = 0;
    const old = sessionDeviceKey('old', random, { store, now: () => t });
    t = DEVICE_KEY_TTL + 1;
    for (let i = 0; i < MAX_DEVICE_KEYS + 5; i++) sessionDeviceKey(`s${i}`, random, { store, now: () => t });
    const saved = JSON.parse(store.m.get('together.devices.v1')!);
    expect(Object.keys(saved)).toHaveLength(MAX_DEVICE_KEYS);
    expect(saved.old).toBeUndefined();
    expect(sessionDeviceKey('old', random, { store, now: () => t })).not.toBe(old);
  });

  it('works with no storage', () => {
    const broken = { get: () => { throw new Error('no'); }, set: () => { throw new Error('no'); } };
    expect(sessionDeviceKey('x', random, { store: broken })).toMatch(/^random-key/);
  });

  it('lets a block hold after the guest restarts', () => {
    const store = memStore();
    const g = new JoinGate(() => 0);
    const first = deviceKey('peer-1', 'member-a', sessionDeviceKey('1a2b3c4d', random, { store }));
    g.remove(first, true);
    // After a restart: another socket, another member id, the same device key.
    const again = deviceKey('peer-2', 'member-b', sessionDeviceKey('1a2b3c4d', random, { store }));
    expect(g.screen(again, { guests: 0, pending: [] })).toBe('blocked');
    expect(g.screenReturn(again)).toBe('blocked');
  });
});

describe('join context device key', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { decodeLink, encodeLink } = require('../protocol') as typeof import('../protocol');

  it('goes over the link, and a key that is too long is dropped', () => {
    const ok = decodeLink(encodeLink({ t: 'join', ctx: { v: 1, name: 'Sam', have: false, memberId: 'm1', device: 'abc123abc123abc1' } }));
    expect(ok).toEqual({ t: 'join', ctx: { v: 1, name: 'Sam', have: false, memberId: 'm1', device: 'abc123abc123abc1' } });
    const long = decodeLink(encodeLink({ t: 'join', ctx: { v: 1, name: 'Sam', have: false, device: 'x'.repeat(65) } }));
    expect(long).toEqual({ t: 'join', ctx: { v: 1, name: 'Sam', have: false } });
  });
});
