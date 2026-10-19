import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';

import { cacheStorage } from '@/storage/kv';

import { describeError } from './errors';

const DAY = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data shows at once; a refetch runs in the background when it is older than this.
      staleTime: 60 * 1000,
      gcTime: 7 * DAY,
      retry: (count, error) => {
        const kind = describeError(error).kind;
        if (kind === 'auth' || kind === 'forbidden' || kind === 'notFound') return false;
        return count < 2;
      },
      networkMode: 'offlineFirst',
    },
  },
});

export const queryPersister = createSyncStoragePersister({
  storage: {
    getItem: (key) => cacheStorage.getString(key) ?? null,
    setItem: (key, value) => cacheStorage.set(key, value),
    removeItem: (key) => {
      cacheStorage.remove(key);
    },
  },
  throttleTime: 2000,
});

/** Bump to drop every persisted cache after a breaking change in cached shapes. */
export const CACHE_BUSTER = 'v1';
export const CACHE_MAX_AGE = 7 * DAY;

/** Search results are not worth keeping across launches. */
export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[3] !== 'search';
}

export function clearQueryCache(): void {
  queryClient.clear();
  cacheStorage.clearAll();
}
