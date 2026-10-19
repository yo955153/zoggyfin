/**
 * Server first, downloads second. Lists that a page needs (an album's
 * tracks, a playlist) come from the server; when it cannot be reached, the
 * downloaded copy stands in, so the app works with no server.
 */
import { describeError } from '@/api/errors';
import { isOffline, reportNetworkError } from '@/lib/online';

export function isNetworkError(e: unknown): boolean {
  const kind = describeError(e).kind;
  return kind === 'offline' || kind === 'timeout';
}

export async function serverOrLocal<T>(remote: () => Promise<T>, local: () => T | null | undefined): Promise<T> {
  if (isOffline()) {
    const l = local();
    if (l !== null && l !== undefined) return l;
  }
  try {
    return await remote();
  } catch (e) {
    if (isNetworkError(e)) {
      reportNetworkError();
      const l = local();
      if (l !== null && l !== undefined) return l;
    }
    throw e;
  }
}
