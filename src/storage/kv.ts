/**
 * Web (and default) key-value store, on top of localStorage with a prefix per store.
 * Native builds resolve `kv.native.ts` (MMKV) instead.
 */
import type { KeyValueStore } from './kv-types';

const memory = new Map<string, string>();

function local(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function webStore(prefix: string): KeyValueStore {
  const p = `${prefix}:`;
  return {
    getString: (key) => {
      const ls = local();
      if (!ls) return memory.get(p + key);
      try {
        return ls.getItem(p + key) ?? undefined;
      } catch {
        return memory.get(p + key);
      }
    },
    set: (key, value) => {
      const ls = local();
      try {
        if (ls) ls.setItem(p + key, value);
        else memory.set(p + key, value);
      } catch {
        // Quota or private mode: keep it for this session only.
        memory.set(p + key, value);
      }
    },
    remove: (key) => {
      memory.delete(p + key);
      try {
        local()?.removeItem(p + key);
      } catch {
        // ignore
      }
    },
    clearAll: () => {
      for (const k of [...memory.keys()]) if (k.startsWith(p)) memory.delete(k);
      const ls = local();
      if (!ls) return;
      try {
        const keys: string[] = [];
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k?.startsWith(p)) keys.push(k);
        }
        keys.forEach((k) => ls.removeItem(k));
      } catch {
        // ignore
      }
    },
  };
}

export const storage = webStore('zoggyfin');
export const cacheStorage = webStore('zoggyfin-query-cache');
