import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';
import { cacheStorage, storage } from '@/storage/kv';
import { secureStore } from '@/storage/secure';

import {
  type AccountRef,
  type AccountsData,
  addSignIn,
  cacheStorageKey,
  EMPTY_ACCOUNTS,
  findServer,
  findUser,
  LEGACY_CACHE_KEY,
  type LegacySession,
  loadAccounts,
  removeServer as removeServerFrom,
  removeUser as removeUserFrom,
  type ServerPatch,
  startUrl,
  tokenKey,
  updateServer as updateServerIn,
  updateUser as updateUserIn,
} from './accounts';

/** One signed-in account on one server: the active one. */
export interface Session {
  /** The address in use now. It changes when the app picks another address of the same server. */
  serverUrl: string;
  serverId: string;
  serverName: string;
  serverVersion: string | null;
  userId: string;
  userName: string;
  userImageTag: string | null;
  token: string;
}

/** The single-account format. It is still written for the active account, so an older app version keeps working. */
const LEGACY_SESSION_KEY = 'session.active';
const ACCOUNTS_KEY = 'accounts';

function saveAccounts(data: AccountsData, session: Session | null): void {
  writeJson(ACCOUNTS_KEY, data);
  if (session) {
    const { token: _token, ...legacy } = session;
    writeJson(LEGACY_SESSION_KEY, legacy satisfies LegacySession);
  } else {
    storage.remove(LEGACY_SESSION_KEY);
  }
}

/** Removes an account's saved query cache, now and once more after the persister's last throttled write. */
function dropCache(ref: AccountRef): void {
  const key = cacheStorageKey(ref);
  cacheStorage.remove(key);
  setTimeout(() => cacheStorage.remove(key), 2500);
}

/** The session of an account, or null when it has no token on this device. */
function sessionOf(data: AccountsData, ref: AccountRef | null, url?: string | null): Session | null {
  if (!ref) return null;
  const server = findServer(data, ref.serverId);
  const user = findUser(data, ref);
  if (!server || !user) return null;
  const token = secureStore.get(tokenKey(ref.serverId, ref.userId));
  const serverUrl = url ?? startUrl(server);
  if (!token || !serverUrl) return null;
  return {
    serverUrl,
    serverId: server.id,
    serverName: server.name,
    serverVersion: server.version,
    userId: user.userId,
    userName: user.userName,
    userImageTag: user.userImageTag,
    token,
  };
}

/**
 * Reads the saved accounts synchronously, so a cold start can render the
 * signed-in shell (and the cached Home) on the first frame. The first launch
 * after the update moves the single-account format to the new one.
 */
function load(): { data: AccountsData; session: Session | null } {
  const raw = readJson<unknown>(ACCOUNTS_KEY, null);
  const data = loadAccounts(raw, raw ? null : readJson<unknown>(LEGACY_SESSION_KEY, null));
  if (!raw && data.active) {
    // Migration: keep the cached pages of the old single account under its new key.
    const old = cacheStorage.getString(LEGACY_CACHE_KEY);
    if (old !== undefined) {
      cacheStorage.set(cacheStorageKey(data.active), old);
      cacheStorage.remove(LEGACY_CACHE_KEY);
    }
    writeJson(ACCOUNTS_KEY, data);
  }
  return { data, session: sessionOf(data, data.active) };
}

interface SessionState {
  accounts: AccountsData;
  session: Session | null;
  /** Saves a new sign-in (a new server, or a new user on a saved server) and makes it active. */
  signIn: (session: Session) => void;
  /** Signs the active user out. Another saved account becomes active, if there is one. */
  signOut: () => void;
  /** Makes a saved account active. False when it has no token here (sign in again). */
  switchTo: (ref: AccountRef) => boolean;
  /** Signs one user out (the active one or another). */
  removeUser: (ref: AccountRef) => void;
  removeServer: (serverId: string) => void;
  updateServer: (serverId: string, patch: ServerPatch) => void;
  /** The connection check picked an address for a server. */
  setServerUrl: (serverId: string, url: string) => void;
  updateUser: (patch: Partial<Pick<Session, 'userName' | 'userImageTag'>>) => void;
}

const initial = (() => {
  try {
    return load();
  } catch {
    return { data: EMPTY_ACCOUNTS, session: null };
  }
})();

export const useSessionStore = create<SessionState>((set, get) => {
  const commit = (accounts: AccountsData, session: Session | null) => {
    saveAccounts(accounts, session);
    set({ accounts, session });
  };
  return {
    accounts: initial.data,
    session: initial.session,
    signIn: (session) => {
      secureStore.set(tokenKey(session.serverId, session.userId), session.token);
      const accounts = addSignIn(get().accounts, {
        serverId: session.serverId,
        serverName: session.serverName,
        serverVersion: session.serverVersion,
        url: session.serverUrl,
        user: { userId: session.userId, userName: session.userName, userImageTag: session.userImageTag },
      });
      commit(accounts, session);
    },
    signOut: () => {
      const s = get().session;
      if (s) get().removeUser({ serverId: s.serverId, userId: s.userId });
      else commit({ ...get().accounts, active: null }, null);
    },
    switchTo: (ref) => {
      const accounts = { ...get().accounts, active: ref };
      const session = sessionOf(accounts, ref);
      if (!session) return false;
      commit(accounts, session);
      return true;
    },
    removeUser: (ref) => {
      secureStore.remove(tokenKey(ref.serverId, ref.userId));
      dropCache(ref);
      const prev = get().session;
      const accounts = removeUserFrom(get().accounts, ref);
      const keep = prev && accounts.active?.serverId === prev.serverId && accounts.active.userId === prev.userId;
      commit(accounts, keep ? prev : sessionOf(accounts, accounts.active));
    },
    removeServer: (serverId) => {
      const server = findServer(get().accounts, serverId);
      for (const u of server?.users ?? []) {
        secureStore.remove(tokenKey(serverId, u.userId));
        dropCache({ serverId, userId: u.userId });
      }
      const prev = get().session;
      const accounts = removeServerFrom(get().accounts, serverId);
      commit(accounts, prev && prev.serverId !== serverId ? prev : sessionOf(accounts, accounts.active));
    },
    updateServer: (serverId, patch) => {
      const accounts = updateServerIn(get().accounts, serverId, patch);
      const s = get().session;
      const server = findServer(accounts, serverId);
      let session = s;
      if (s && server && s.serverId === serverId) {
        // A removed address must not stay in use.
        const url = server.addresses.some((a) => a.url === s.serverUrl) ? s.serverUrl : startUrl(server);
        session = url ? { ...s, serverName: server.name, serverVersion: server.version, serverUrl: url } : s;
      }
      commit(accounts, session);
    },
    setServerUrl: (serverId, url) => {
      const server = findServer(get().accounts, serverId);
      if (!server || !server.addresses.some((a) => a.url === url)) return;
      const s = get().session;
      if (server.lastUrl === url && (!s || s.serverId !== serverId || s.serverUrl === url)) return;
      const accounts = updateServerIn(get().accounts, serverId, { lastUrl: url });
      commit(accounts, s && s.serverId === serverId ? { ...s, serverUrl: url } : s);
    },
    updateUser: (patch) => {
      const current = get().session;
      if (!current) return;
      const next = { ...current, ...patch };
      commit(updateUserIn(get().accounts, { serverId: current.serverId, userId: current.userId }, patch), next);
    },
  };
});

export function useSession(): Session | null {
  return useSessionStore((s) => s.session);
}

export function useAccounts(): AccountsData {
  return useSessionStore((s) => s.accounts);
}

/** The token of a saved account, for work that runs for an account that is not active (downloads). */
export function tokenFor(ref: AccountRef): string | null {
  return secureStore.get(tokenKey(ref.serverId, ref.userId));
}
