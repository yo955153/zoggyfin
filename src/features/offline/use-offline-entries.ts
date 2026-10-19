import { create } from 'zustand';

import { useSessionStore } from '@/auth/session-store';
import { downloadsSupported } from '@/downloads';
import { useDownloadsStore } from '@/downloads/store';
import { useOnlineStore } from '@/lib/online';
import { nearbySupported } from '@/together/nearby';

import { completedCount, offlineEntries, type OfflineEntries } from './entries';

/** The offline entries for the current state (see entries.ts), and the number of downloads. */
export function useOfflineEntries(): OfflineEntries & { count: number } {
  const signedIn = useSessionStore((s) => !!s.session);
  const reachable = useOnlineStore((s) => s.reachable);
  const count = useDownloadsStore((s) => (downloadsSupported ? completedCount(s.records) : 0));
  return { ...offlineEntries({ signedIn, serverReachable: reachable, downloads: count, nearby: nearbySupported }), count };
}

/**
 * True once the sign-in screen has shown with no account: from then on the
 * players and the offline Downloads route are open with no sign-in. It is a
 * flag and not "always open", so a route fallback while signed out goes to the
 * sign-in screen, never to an empty player.
 */
export const useNoAccountStore = create<{ open: boolean }>(() => ({ open: false }));

export function setNoAccountOpen(open: boolean): void {
  if (useNoAccountStore.getState().open !== open) useNoAccountStore.setState({ open });
}
