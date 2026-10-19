/**
 * The first launch after the update: an install with one saved account in
 * the old format signs in at once, with its token and its cached pages.
 */
const mockKv = new Map<string, string>();
const mockCache = new Map<string, string>();
const mockSecure = new Map<string, string>();

function mockStore(m: Map<string, string>) {
  return { getString: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), remove: (k: string) => void m.delete(k), clearAll: () => m.clear() };
}

jest.mock('@/storage/kv', () => ({ storage: mockStore(mockKv), cacheStorage: mockStore(mockCache) }));
jest.mock('@/storage/secure', () => ({
  secureStore: { get: (k: string) => mockSecure.get(k) ?? null, set: (k: string, v: string) => void mockSecure.set(k, v), remove: (k: string) => void mockSecure.delete(k) },
}));

const LEGACY = {
  serverUrl: 'http://192.0.2.10:8096',
  serverId: 'server-a',
  serverName: 'Home media',
  serverVersion: '10.11.5',
  userId: 'user-1',
  userName: 'Sam',
  userImageTag: 'tag1',
};

function freshStore() {
  let mod: typeof import('../session-store') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../session-store');
  });
  return mod!.useSessionStore;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockKv.clear();
  mockCache.clear();
  mockSecure.clear();
});

afterEach(() => jest.useRealTimers());

describe('query cache scope', () => {
  it('keeps only the active account in its persisted cache', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { inScope } = require('@/api/query-client') as typeof import('@/api/query-client');
    const ref = { serverId: 'server-a', userId: 'user-1' };
    expect(inScope(['jf', 'server-a', 'user-1', 'views'], ref)).toBe(true);
    expect(inScope(['jf', 'server-b', 'user-1', 'views'], ref)).toBe(false);
    expect(inScope(['jf', 'server-a', 'user-2', 'views'], ref)).toBe(false);
    expect(inScope(['jf', 'server-a', 'user-1'], null)).toBe(false);
  });
});

describe('session migration', () => {
  it('migrates one saved account without a new sign-in', () => {
    mockKv.set('session.active', JSON.stringify(LEGACY));
    mockSecure.set('token.server-a.user-1', 'secret-token');
    mockCache.set('REACT_QUERY_OFFLINE_CACHE', '{"clientState":{}}');

    const store = freshStore();
    expect(store.getState().session).toEqual({ ...LEGACY, token: 'secret-token' });
    const saved = JSON.parse(mockKv.get('accounts') ?? 'null');
    expect(saved.servers[0].addresses).toEqual([{ url: 'http://192.0.2.10:8096', kind: 'external' }]);
    expect(saved.active).toEqual({ serverId: 'server-a', userId: 'user-1' });
    // The cached pages move to the account's own key.
    expect(mockCache.get('rq.server-a.user-1')).toBe('{"clientState":{}}');
    expect(mockCache.has('REACT_QUERY_OFFLINE_CACHE')).toBe(false);
    // Tokens never go into plain storage.
    expect(mockKv.get('accounts')).not.toContain('secret-token');
  });

  it('runs once: a second launch reads the new format', () => {
    mockKv.set('session.active', JSON.stringify(LEGACY));
    mockSecure.set('token.server-a.user-1', 'secret-token');
    freshStore().getState().updateServer('server-a', { name: 'Renamed' });
    const again = freshStore();
    expect(again.getState().session?.serverName).toBe('Renamed');
  });

  it('starts signed out when the token is missing', () => {
    mockKv.set('session.active', JSON.stringify(LEGACY));
    expect(freshStore().getState().session).toBeNull();
  });

  it('switches accounts and keeps the old format current for the active one', () => {
    mockKv.set('session.active', JSON.stringify(LEGACY));
    mockSecure.set('token.server-a.user-1', 'secret-token');
    const store = freshStore();
    store.getState().signIn({ ...LEGACY, serverId: 'server-b', serverUrl: 'https://jellyfin.example.com', userId: 'user-9', userName: 'Jane', token: 'token-b' });
    expect(store.getState().session?.serverId).toBe('server-b');
    expect(JSON.parse(mockKv.get('session.active') ?? '{}').serverId).toBe('server-b');
    expect(store.getState().switchTo({ serverId: 'server-a', userId: 'user-1' })).toBe(true);
    expect(store.getState().session?.token).toBe('secret-token');
    store.getState().signOut();
    expect(store.getState().session?.serverId).toBe('server-b');
    expect(mockSecure.has('token.server-a.user-1')).toBe(false);
  });

  it('uses a new address of the active server at once', () => {
    mockKv.set('session.active', JSON.stringify(LEGACY));
    mockSecure.set('token.server-a.user-1', 'secret-token');
    const store = freshStore();
    store.getState().updateServer('server-a', {
      addresses: [
        { url: 'http://192.0.2.10:8096', kind: 'internal' },
        { url: 'https://jellyfin.example.com', kind: 'external' },
      ],
    });
    store.getState().setServerUrl('server-a', 'https://jellyfin.example.com');
    expect(store.getState().session?.serverUrl).toBe('https://jellyfin.example.com');
    // An address that is not in the list is never used.
    store.getState().setServerUrl('server-a', 'https://other.example.com');
    expect(store.getState().session?.serverUrl).toBe('https://jellyfin.example.com');
  });
});
