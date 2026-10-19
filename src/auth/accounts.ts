/**
 * Saved servers and the users signed in to them. Pure data and functions,
 * so the migration and every change are unit-tested; `session-store.ts`
 * keeps the data in storage and the tokens in the secure store.
 *
 * Tokens are never in this data. Each one is in the secure store under
 * `tokenKey(serverId, userId)`, the same key that the single-account format used.
 */
import { addAddress, type ConnectionMode, guessKind, sameServerId, type ServerAddress } from '@/servers/addresses';
import { NO_WIFI_RULE, type WifiRule } from '@/servers/wifi-rule';

export const ACCOUNTS_SCHEMA_VERSION = 1;

export interface SavedUser {
  userId: string;
  userName: string;
  userImageTag: string | null;
}

export interface SavedServer {
  /** The Jellyfin server Id. */
  id: string;
  name: string;
  version: string | null;
  /** In the user's order: the first address that answers wins. */
  addresses: ServerAddress[];
  mode: ConnectionMode;
  wifi: WifiRule;
  /** The address used last, so a cold start uses it before the first probe. */
  lastUrl: string | null;
  users: SavedUser[];
}

export interface AccountRef {
  serverId: string;
  userId: string;
}

export interface AccountsData {
  schemaVersion: typeof ACCOUNTS_SCHEMA_VERSION;
  servers: SavedServer[];
  active: AccountRef | null;
}

export const EMPTY_ACCOUNTS: AccountsData = { schemaVersion: ACCOUNTS_SCHEMA_VERSION, servers: [], active: null };

export const tokenKey = (serverId: string, userId: string): string => `token.${serverId}.${userId}`;

/** The single-account format (before multiple servers): `session.active` in storage. */
export interface LegacySession {
  serverUrl: string;
  serverId: string;
  serverName: string;
  serverVersion: string | null;
  userId: string;
  userName: string;
  userImageTag: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Turns the single-account format into the new one. Null when it is not a usable record. */
export function migrateLegacy(raw: unknown): AccountsData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const serverUrl = str(v.serverUrl);
  const serverId = str(v.serverId);
  const userId = str(v.userId);
  if (!serverUrl || !serverId || !userId) return null;
  const server: SavedServer = {
    id: serverId,
    name: str(v.serverName) ?? 'Jellyfin',
    version: str(v.serverVersion),
    addresses: [{ url: serverUrl, kind: guessKind(serverUrl) }],
    mode: 'auto',
    wifi: NO_WIFI_RULE,
    lastUrl: serverUrl,
    users: [{ userId, userName: str(v.userName) ?? 'User', userImageTag: str(v.userImageTag) }],
  };
  return { schemaVersion: ACCOUNTS_SCHEMA_VERSION, servers: [server], active: { serverId, userId } };
}

function validServer(s: unknown): s is SavedServer {
  if (typeof s !== 'object' || s === null) return false;
  const v = s as Partial<SavedServer>;
  return typeof v.id === 'string' && Array.isArray(v.addresses) && Array.isArray(v.users);
}

/**
 * Reads saved data. `stored` is the new format, `legacy` the old
 * `session.active`; the old one is used only when there is no new one.
 */
export function loadAccounts(stored: unknown, legacy: unknown): AccountsData {
  if (typeof stored === 'object' && stored !== null && Array.isArray((stored as AccountsData).servers)) {
    const v = stored as AccountsData;
    const servers = v.servers.filter(validServer).map((s) => ({
      ...s,
      mode: s.mode ?? 'auto',
      wifi: s.wifi ?? NO_WIFI_RULE,
      lastUrl: s.lastUrl ?? s.addresses[0]?.url ?? null,
    }));
    const active = v.active && findUser({ ...v, servers }, v.active) ? v.active : null;
    return { schemaVersion: ACCOUNTS_SCHEMA_VERSION, servers, active };
  }
  return migrateLegacy(legacy) ?? EMPTY_ACCOUNTS;
}

export function findServer(data: AccountsData, serverId: string | null | undefined): SavedServer | null {
  // Jellyfin writes the Id with and without dashes: one server, one entry.
  return data.servers.find((s) => sameServerId(s.id, serverId)) ?? null;
}

export function findUser(data: AccountsData, ref: AccountRef | null): SavedUser | null {
  if (!ref) return null;
  return findServer(data, ref.serverId)?.users.find((u) => u.userId === ref.userId) ?? null;
}

function replaceServer(data: AccountsData, server: SavedServer): AccountsData {
  const exists = data.servers.some((s) => sameServerId(s.id, server.id));
  return { ...data, servers: exists ? data.servers.map((s) => (sameServerId(s.id, server.id) ? server : s)) : [...data.servers, server] };
}

export interface SignInFacts {
  serverId: string;
  serverName: string;
  serverVersion: string | null;
  /** The address the user signed in through. */
  url: string;
  user: SavedUser;
}

/** Adds or updates the server and the user after a sign-in, and makes that account active. */
export function addSignIn(data: AccountsData, f: SignInFacts): AccountsData {
  const prev = findServer(data, f.serverId);
  const server: SavedServer = prev
    ? {
        ...prev,
        name: f.serverName || prev.name,
        version: f.serverVersion ?? prev.version,
        addresses: addAddress(prev.addresses, f.url),
        lastUrl: f.url,
        users: prev.users.some((u) => u.userId === f.user.userId)
          ? prev.users.map((u) => (u.userId === f.user.userId ? f.user : u))
          : [...prev.users, f.user],
      }
    : {
        id: f.serverId,
        name: f.serverName || 'Jellyfin',
        version: f.serverVersion,
        addresses: [{ url: f.url, kind: guessKind(f.url) }],
        mode: 'auto',
        wifi: NO_WIFI_RULE,
        lastUrl: f.url,
        users: [f.user],
      };
  return { ...replaceServer(data, server), active: { serverId: server.id, userId: f.user.userId } };
}

/**
 * Saves a server with no signed-in user (an invite whose server does not
 * answer yet), or adds new addresses to a saved one. The active account stays.
 */
export function addServer(data: AccountsData, f: { serverId: string; serverName: string; addresses: readonly ServerAddress[] }): AccountsData {
  const prev = findServer(data, f.serverId);
  if (prev) {
    let addresses = prev.addresses;
    for (const a of f.addresses) addresses = addAddress(addresses, a.url, a.kind);
    return replaceServer(data, { ...prev, addresses });
  }
  if (!f.addresses.length) return data;
  return replaceServer(data, {
    id: f.serverId,
    name: f.serverName || 'Jellyfin',
    version: null,
    addresses: [...f.addresses],
    mode: 'auto',
    wifi: NO_WIFI_RULE,
    lastUrl: null,
    users: [],
  });
}

/** The account to use after `gone` is removed: another user on the same server first, then any user. */
function nextActive(data: AccountsData, gone: AccountRef | null): AccountRef | null {
  if (data.active && findUser(data, data.active)) return data.active;
  const same = gone ? findServer(data, gone.serverId)?.users[0] : undefined;
  if (gone && same) return { serverId: gone.serverId, userId: same.userId };
  for (const s of data.servers) if (s.users[0]) return { serverId: s.id, userId: s.users[0].userId };
  return null;
}

/** Signs one user out. The server stays saved, also with no users, so adding a user is quick. */
export function removeUser(data: AccountsData, ref: AccountRef): AccountsData {
  const server = findServer(data, ref.serverId);
  if (!server) return data;
  const next = replaceServer(data, { ...server, users: server.users.filter((u) => u.userId !== ref.userId) });
  const wasActive = data.active?.serverId === ref.serverId && data.active.userId === ref.userId;
  const active = wasActive ? nextActive({ ...next, active: null }, ref) : next.active;
  return { ...next, active };
}

/** Removes a server and all its users. */
export function removeServer(data: AccountsData, serverId: string): AccountsData {
  const next = { ...data, servers: data.servers.filter((s) => s.id !== serverId) };
  const active = data.active?.serverId === serverId ? nextActive({ ...next, active: null }, null) : next.active;
  return { ...next, active };
}

export type ServerPatch = Partial<Pick<SavedServer, 'name' | 'version' | 'addresses' | 'mode' | 'wifi' | 'lastUrl'>>;

export function updateServer(data: AccountsData, serverId: string, patch: ServerPatch): AccountsData {
  const server = findServer(data, serverId);
  if (!server) return data;
  return replaceServer(data, { ...server, ...patch });
}

export function updateUser(data: AccountsData, ref: AccountRef, patch: Partial<Omit<SavedUser, 'userId'>>): AccountsData {
  const server = findServer(data, ref.serverId);
  if (!server) return data;
  return replaceServer(data, { ...server, users: server.users.map((u) => (u.userId === ref.userId ? { ...u, ...patch } : u)) });
}

/** The address a server starts with: the last one used, if it is still in the list, else the first one. */
export function startUrl(server: SavedServer): string | null {
  if (server.lastUrl && server.addresses.some((a) => a.url === server.lastUrl)) return server.lastUrl;
  return server.addresses[0]?.url ?? null;
}

/**
 * The storage key of the persisted query cache of one account. Each account
 * has its own, so data of one server never shows on another.
 */
export function cacheStorageKey(ref: AccountRef): string {
  return `rq.${ref.serverId}.${ref.userId}`;
}

/** The key that the single-account format used for the whole query cache. */
export const LEGACY_CACHE_KEY = 'REACT_QUERY_OFFLINE_CACHE';
