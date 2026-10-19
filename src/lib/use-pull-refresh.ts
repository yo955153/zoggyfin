import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh state. The spinner shows only for a refresh that the user
 * started with a pull, never for a background refetch (design system §8).
 */
export function usePullRefresh(refresh?: () => unknown): { refreshing: boolean; onRefresh?: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    if (!refresh) return;
    setRefreshing(true);
    void Promise.resolve()
      .then(refresh)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [refresh]);
  return { refreshing, onRefresh: refresh ? onRefresh : undefined };
}
