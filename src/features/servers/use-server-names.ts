import { useCallback } from 'react';

import { useAccounts } from '@/auth/session-store';

/** The name of a saved server by its Id, for labels on downloads. A removed server has a fixed name. */
export function useServerNames(): (serverId: string | null | undefined) => string {
  const { servers } = useAccounts();
  return useCallback((serverId) => servers.find((s) => s.id === serverId)?.name ?? 'A removed server', [servers]);
}
