import type { AuthenticationResult } from '@/api/types';

import { type Session, useSessionStore } from './session-store';

export interface ServerInfo {
  url: string;
  serverId: string;
  serverName: string;
  version: string | null;
}

/** Turns an authentication result into the active session. */
export function completeSignIn(server: ServerInfo, result: AuthenticationResult): void {
  const user = result.User;
  if (!result.AccessToken || !user?.Id) throw new Error('The server did not return a session.');
  const session: Session = {
    serverUrl: server.url,
    serverId: result.ServerId ?? server.serverId,
    serverName: server.serverName,
    serverVersion: server.version,
    userId: user.Id,
    userName: user.Name ?? 'User',
    userImageTag: user.PrimaryImageTag ?? null,
    token: result.AccessToken,
  };
  // The query cache is per account (see app/_layout.tsx), so nothing is cleared here.
  useSessionStore.getState().signIn(session);
}
