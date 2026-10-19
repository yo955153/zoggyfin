import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';
import { secureStore } from '@/storage/secure';

/** One signed-in account on one server. */
export interface Session {
  serverUrl: string;
  serverId: string;
  serverName: string;
  serverVersion: string | null;
  userId: string;
  userName: string;
  userImageTag: string | null;
  token: string;
}

type StoredSession = Omit<Session, 'token'>;

const SESSION_KEY = 'session.active';
const tokenKey = (s: Pick<Session, 'serverId' | 'userId'>) => `token.${s.serverId}.${s.userId}`;

/**
 * Reads the stored session synchronously, so a cold start can render the
 * signed-in shell (and the cached Home) on the first frame.
 */
function loadSession(): Session | null {
  const stored = readJson<StoredSession | null>(SESSION_KEY, null);
  if (!stored) return null;
  const token = secureStore.get(tokenKey(stored));
  return token ? { ...stored, token } : null;
}

interface SessionState {
  session: Session | null;
  signIn: (session: Session) => void;
  signOut: () => void;
  updateUser: (patch: Partial<Pick<Session, 'userName' | 'userImageTag'>>) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: loadSession(),
  signIn: (session) => {
    const { token, ...rest } = session;
    secureStore.set(tokenKey(session), token);
    writeJson(SESSION_KEY, rest);
    set({ session });
  },
  signOut: () => {
    const current = get().session;
    if (current) {
      secureStore.remove(tokenKey(current));
    }
    storage.remove(SESSION_KEY);
    set({ session: null });
  },
  updateUser: (patch) => {
    const current = get().session;
    if (!current) return;
    const next = { ...current, ...patch };
    const { token: _token, ...rest } = next;
    writeJson(SESSION_KEY, rest);
    set({ session: next });
  },
}));

export function useSession(): Session | null {
  return useSessionStore((s) => s.session);
}
