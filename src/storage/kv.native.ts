import { createMMKV } from 'react-native-mmkv';

import type { KeyValueStore } from './kv-types';

function mmkvStore(id: string): KeyValueStore {
  const m = createMMKV({ id });
  return {
    getString: (key) => m.getString(key),
    set: (key, value) => m.set(key, value),
    remove: (key) => {
      m.remove(key);
    },
    clearAll: () => m.clearAll(),
  };
}

export const storage = mmkvStore('zoggyfin');
export const cacheStorage = mmkvStore('zoggyfin-query-cache');
