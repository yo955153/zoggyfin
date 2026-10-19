/**
 * Invite links that reach the app (a tap on the link, the desktop app's
 * zoggyfin:// handler, a pasted link), and the invite that waits for its
 * server. The waiting invite has the one-time password, so it is in the
 * secure store. Never log these values.
 */
import { create } from 'zustand';

import { secureStore } from '@/storage/secure';

const PENDING_KEY = 'invite.pending';

/** The payload of the last link, until the invite screen takes it. */
export const useIncomingInvite = create<{ payload: string | null }>(() => ({ payload: null }));

export function setIncomingInvite(payload: string): void {
  useIncomingInvite.setState({ payload });
}

export function takeIncomingInvite(): string | null {
  const { payload } = useIncomingInvite.getState();
  if (payload) useIncomingInvite.setState({ payload: null });
  return payload;
}

/** Keeps an invite whose server does not answer yet, so the person can try again later. */
export function savePendingInvite(payload: string): void {
  secureStore.set(PENDING_KEY, payload);
}

export function loadPendingInvite(): string | null {
  return secureStore.get(PENDING_KEY) ?? null;
}

export function clearPendingInvite(): void {
  secureStore.remove(PENDING_KEY);
}
