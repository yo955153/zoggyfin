import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The shortest time the pull-to-refresh spinner stays up. A refresh that ends
 * sooner (a cached or deduped refetch) would make the iOS spinner blink: it
 * starts to show, hides at once and the list jumps back.
 */
export const MIN_REFRESH_MS = 500;

/**
 * The state machine behind `usePullRefresh`, with no React, so tests can drive it.
 * One pull runs at a time: a second pull while one runs is ignored, so the
 * spinner never goes off and on again. `onChange(false)` comes once, when the
 * refresh has settled (also on an error) and `minMs` has passed.
 */
export function createPullRefresh(onChange: (refreshing: boolean) => void, minMs = MIN_REFRESH_MS, now: () => number = Date.now) {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    /** Starts a refresh. Returns false when one already runs. */
    start(run: () => unknown): boolean {
      if (busy) return false;
      busy = true;
      onChange(true);
      const started = now();
      void Promise.resolve()
        .then(run)
        .catch(() => undefined)
        .then(() => {
          const wait = Math.max(0, minMs - (now() - started));
          setTimeout(() => {
            busy = false;
            onChange(false);
          }, wait);
        });
      return true;
    },
  };
}

/**
 * Pull-to-refresh state. The spinner shows only for a refresh that the user
 * started with a pull, never for a background refetch (design system §8).
 * It stays up until the promise from `refresh` settles, and at least
 * `MIN_REFRESH_MS`, so it never blinks. `refresh` must return a promise that
 * covers all its refetches (for example `Promise.all`), or the spinner hides
 * after the minimum time while the data still loads.
 */
export function usePullRefresh(refresh?: () => unknown, minMs = MIN_REFRESH_MS): { refreshing: boolean; onRefresh?: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  const ctl = useRef<ReturnType<typeof createPullRefresh> | null>(null);
  // A stable `onRefresh`: callers often pass a new arrow function each render.
  const onRefresh = useCallback(() => {
    ctl.current ??= createPullRefresh(setRefreshing, minMs);
    ctl.current.start(() => latest.current?.());
  }, [minMs]);
  return { refreshing, onRefresh: refresh ? onRefresh : undefined };
}
