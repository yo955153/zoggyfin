import { storage } from './kv';

/**
 * Web has no keychain. The token is kept in localStorage, the same as the
 * Jellyfin web client does. Native builds use `secure.native.ts`.
 */
export const secureStore = {
  get(key: string): string | null {
    return storage.getString(`secure.${key}`) ?? null;
  },
  set(key: string, value: string): void {
    storage.set(`secure.${key}`, value);
  },
  remove(key: string): void {
    storage.remove(`secure.${key}`);
  },
};
