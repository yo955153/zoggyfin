import { addSignIn, EMPTY_ACCOUNTS, findServer } from '../accounts';
import { adoptServer, learnAddresses, markReached, REACHED_EVERY_MS, reinstallCandidate, STALE_AFTER_MS, staleSince } from '../server-identity';

const ID = '0123456789abcdef0123456789abcdef';
const DASHED = '01234567-89ab-cdef-0123-456789abcdef';
const facts = (serverId: string, userId: string, url: string, serverName = 'Home media') => ({
  serverId,
  serverName,
  serverVersion: '10.11.5',
  url,
  user: { userId, userName: 'Sam', userImageTag: null },
});

describe('one server per Id', () => {
  it('merges a sign-in through a new address, also when the Id has dashes', () => {
    let data = addSignIn(EMPTY_ACCOUNTS, facts(ID, 'u1', 'http://192.0.2.10:8096'));
    data = addSignIn(data, facts(DASHED, 'u1', 'https://media.example.com'));
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0].id).toBe(ID);
    expect(data.servers[0].addresses.map((a) => a.url)).toEqual(['http://192.0.2.10:8096', 'https://media.example.com']);
    expect(data.active).toEqual({ serverId: ID, userId: 'u1' });
    expect(findServer(data, DASHED)?.id).toBe(ID);
  });
});

describe('learnAddresses', () => {
  const base = addSignIn(EMPTY_ACCOUNTS, facts(ID, 'u1', 'http://192.0.2.10:8096'));

  it('adds a found address at the end of a saved server, marked found', () => {
    const data = learnAddresses(base, [{ serverId: DASHED, url: 'http://192.0.2.44:8096' }], 5000);
    expect(data.servers[0].addresses).toEqual([
      { url: 'http://192.0.2.10:8096', kind: 'external' },
      { url: 'http://192.0.2.44:8096', kind: 'external', found: true, lastOkAt: 5000 },
    ]);
  });

  it('ignores servers that are not saved and keeps the same object when nothing changes', () => {
    expect(learnAddresses(base, [{ serverId: 'other', url: 'http://192.0.2.50:8096' }], 1)).toBe(base);
    const once = learnAddresses(base, [{ serverId: ID, url: 'http://192.0.2.10:8096/' }], 1000);
    expect(once.servers[0].addresses).toHaveLength(1);
    expect(once.servers[0].addresses[0].lastOkAt).toBe(1000);
    expect(learnAddresses(once, [{ serverId: ID, url: 'http://192.0.2.10:8096' }], 2000)).toBe(once);
  });
});

describe('stale addresses', () => {
  const base = addSignIn(EMPTY_ACCOUNTS, facts(ID, 'u1', 'http://192.0.2.10:8096'));

  it('records the last answer, at most once an hour', () => {
    const a = markReached(base, ID, 'http://192.0.2.10:8096', 10_000);
    expect(a.servers[0].addresses[0].lastOkAt).toBe(10_000);
    expect(markReached(a, ID, 'http://192.0.2.10:8096', 10_000 + REACHED_EVERY_MS - 1)).toBe(a);
    expect(markReached(a, ID, 'http://192.0.2.10:8096', 10_000 + REACHED_EVERY_MS + 1).servers[0].addresses[0].lastOkAt).toBe(10_000 + REACHED_EVERY_MS + 1);
    expect(markReached(a, ID, 'http://192.0.2.99:8096', 1)).toBe(a);
  });

  it('marks an address stale after 30 days, never one with no record', () => {
    expect(staleSince({ url: 'http://192.0.2.10:8096', kind: 'internal' }, 1e13)).toBeNull();
    expect(staleSince({ url: 'x', kind: 'internal', lastOkAt: 100 }, 100 + STALE_AFTER_MS)).toBeNull();
    expect(staleSince({ url: 'x', kind: 'internal', lastOkAt: 100 }, 101 + STALE_AFTER_MS)).toBe(100);
  });
});

describe('reinstalled server', () => {
  const OLD = 'aaaa';
  const base = addSignIn(EMPTY_ACCOUNTS, facts(OLD, 'u1', 'http://192.0.2.10:8096', 'Den'));

  it('finds a saved server with the same address or the same name', () => {
    expect(reinstallCandidate(base, { id: 'bbbb', name: 'Other', url: 'http://192.0.2.10:8096' })?.id).toBe(OLD);
    expect(reinstallCandidate(base, { id: 'bbbb', name: ' den ', url: 'https://jf.example.com' })?.id).toBe(OLD);
    expect(reinstallCandidate(base, { id: 'bbbb', name: 'Attic', url: 'https://jf.example.com' })).toBeNull();
    expect(reinstallCandidate(base, { id: OLD, name: 'Den', url: 'http://192.0.2.10:8096' })).toBeNull();
  });

  it('moves the addresses to the new server and removes the old one when nothing stays', () => {
    let data = addSignIn(base, facts('bbbb', 'u9', 'https://jf.example.com', 'Den'));
    data = adoptServer(data, OLD, 'bbbb', false);
    expect(data.servers.map((s) => s.id)).toEqual(['bbbb']);
    expect(data.servers[0].addresses.map((a) => a.url)).toEqual(['https://jf.example.com', 'http://192.0.2.10:8096']);
    expect(data.active).toEqual({ serverId: 'bbbb', userId: 'u9' });
  });

  it('keeps the old entry with no users while downloads stay there', () => {
    let data = addSignIn(base, facts('bbbb', 'u9', 'https://jf.example.com', 'Den'));
    data = adoptServer(data, OLD, 'bbbb', true);
    expect(data.servers.map((s) => [s.id, s.users.length])).toEqual([
      [OLD, 0],
      ['bbbb', 1],
    ]);
  });
});
