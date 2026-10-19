import type { Api } from '@jellyfin/sdk';
import { useMemo } from 'react';

import { type Session, useSession } from '@/auth/session-store';
import type { ServerContext } from '@/images/image-url';

import { getApi } from './client';
import type { SessionScope } from './query-keys';

export interface ApiContext {
  api: Api;
  session: Session;
  userId: string;
  scope: SessionScope;
  server: ServerContext;
}

/**
 * The API for the signed-in session. Screens under the signed-in layout
 * always have a session; this throws if one is used outside it.
 */
export function useApi(): ApiContext {
  const session = useSession();
  if (!session) throw new Error('useApi() needs a signed-in session');
  return useMemo(
    () => ({
      api: getApi(session.serverUrl, session.token),
      session,
      userId: session.userId,
      scope: { serverId: session.serverId, userId: session.userId },
      server: { baseUrl: session.serverUrl, token: session.token },
    }),
    [session],
  );
}

/** The image server context, or null when signed out. Safe anywhere. */
export function useImageServer(): ServerContext | null {
  const session = useSession();
  return useMemo(
    () => (session ? { baseUrl: session.serverUrl, token: session.token } : null),
    [session],
  );
}
