import {
  addSignIn,
  cacheStorageKey,
  EMPTY_ACCOUNTS,
  loadAccounts,
  migrateLegacy,
  removeServer,
  removeUser,
  startUrl,
  tokenKey,
  updateServer,
} from '../accounts';

const LEGACY = {
  serverUrl: 'https://jellyfin.example.com',
  serverId: 'server-a',
  serverName: 'Home media',
  serverVersion: '10.11.5',
  userId: 'user-1',
  userName: 'Sam',
  userImageTag: null,
};

const facts = (serverId: string, userId: string, url = `https://${serverId}.example.com`) => ({
  serverId,
  serverName: serverId,
  serverVersion: '10.11.5',
  url,
  user: { userId, userName: userId, userImageTag: null },
});

describe('migrateLegacy', () => {
  it('turns the single-account format into one server with one user', () => {
    const data = migrateLegacy(LEGACY);
    expect(data).toEqual({
      schemaVersion: 1,
      servers: [
        {
          id: 'server-a',
          name: 'Home media',
          version: '10.11.5',
          addresses: [{ url: 'https://jellyfin.example.com', kind: 'external' }],
          mode: 'auto',
          wifi: { enabled: false, ssids: [] },
          lastUrl: 'https://jellyfin.example.com',
          users: [{ userId: 'user-1', userName: 'Sam', userImageTag: null }],
        },
      ],
      active: { serverId: 'server-a', userId: 'user-1' },
    });
  });
  it('guesses a LAN address as internal', () => {
    expect(migrateLegacy({ ...LEGACY, serverUrl: 'http://10.1.1.2:8096' })?.servers[0].addresses[0].kind).toBe('internal');
  });
  it('ignores broken records', () => {
    expect(migrateLegacy(null)).toBeNull();
    expect(migrateLegacy({ serverUrl: 'x' })).toBeNull();
    expect(migrateLegacy('text')).toBeNull();
  });
  it('keeps the token key of the old format', () => {
    expect(tokenKey('server-a', 'user-1')).toBe('token.server-a.user-1');
  });
});

describe('loadAccounts', () => {
  it('uses the legacy record only when there is no new data', () => {
    expect(loadAccounts(null, LEGACY).active).toEqual({ serverId: 'server-a', userId: 'user-1' });
    const stored = addSignIn(EMPTY_ACCOUNTS, facts('server-b', 'user-2'));
    expect(loadAccounts(stored, LEGACY)).toEqual(stored);
    expect(loadAccounts(null, null)).toEqual(EMPTY_ACCOUNTS);
  });
  it('drops an active account that is not saved', () => {
    const stored = { ...addSignIn(EMPTY_ACCOUNTS, facts('server-b', 'user-2')), active: { serverId: 'gone', userId: 'x' } };
    expect(loadAccounts(stored, null).active).toBeNull();
  });
});

describe('account changes', () => {
  const two = addSignIn(addSignIn(addSignIn(EMPTY_ACCOUNTS, facts('a', 'u1')), facts('a', 'u2')), facts('b', 'u3'));

  it('adds users to a saved server and makes the new sign-in active', () => {
    expect(two.servers.map((s) => s.users.map((u) => u.userId))).toEqual([['u1', 'u2'], ['u3']]);
    expect(two.active).toEqual({ serverId: 'b', userId: 'u3' });
  });
  it('adds a new sign-in address to the list of a saved server', () => {
    const d = addSignIn(two, facts('a', 'u1', 'http://10.1.1.2:8096'));
    expect(d.servers[0].addresses.map((a) => a.url)).toEqual(['https://a.example.com', 'http://10.1.1.2:8096']);
    expect(d.servers[0].users).toHaveLength(2);
  });
  it('after the active user signs out, another user of the same server is active', () => {
    const d = removeUser({ ...two, active: { serverId: 'a', userId: 'u1' } }, { serverId: 'a', userId: 'u1' });
    expect(d.active).toEqual({ serverId: 'a', userId: 'u2' });
  });
  it('after the last user of a server signs out, a user of another server is active', () => {
    const d = removeUser(two, { serverId: 'b', userId: 'u3' });
    expect(d.active).toEqual({ serverId: 'a', userId: 'u1' });
    expect(d.servers.find((s) => s.id === 'b')?.users).toEqual([]);
  });
  it('signing out another user keeps the active one', () => {
    expect(removeUser(two, { serverId: 'a', userId: 'u2' }).active).toEqual({ serverId: 'b', userId: 'u3' });
  });
  it('removes a server with its users', () => {
    const d = removeServer(two, 'b');
    expect(d.servers.map((s) => s.id)).toEqual(['a']);
    expect(d.active).toEqual({ serverId: 'a', userId: 'u1' });
    expect(removeServer(removeServer(two, 'a'), 'b').active).toBeNull();
  });
  it('starts with the last address while it is in the list', () => {
    const s = updateServer(two, 'a', { addresses: [{ url: 'http://10.1.1.2', kind: 'internal' }, { url: 'https://a.example.com', kind: 'external' }], lastUrl: 'https://a.example.com' }).servers[0];
    expect(startUrl(s)).toBe('https://a.example.com');
    expect(startUrl({ ...s, lastUrl: 'http://gone' })).toBe('http://10.1.1.2');
  });
});

describe('cacheStorageKey', () => {
  it('is different for each server and user', () => {
    expect(cacheStorageKey({ serverId: 'a', userId: 'u1' })).toBe('rq.a.u1');
    expect(cacheStorageKey({ serverId: 'b', userId: 'u1' })).not.toBe(cacheStorageKey({ serverId: 'a', userId: 'u1' }));
    expect(cacheStorageKey({ serverId: 'a', userId: 'u2' })).not.toBe(cacheStorageKey({ serverId: 'a', userId: 'u1' }));
  });
});
