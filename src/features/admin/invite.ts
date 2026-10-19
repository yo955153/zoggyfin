/**
 * The "Invite someone" button of the Users screen opens the invite flow of
 * the invite feature (Settings → Servers → <server> → Invite someone). This
 * small adapter is the only place that knows its route.
 */
import { router } from 'expo-router';

export function openInvite(opts: { serverId: string }): void {
  router.push({ pathname: '/(tabs)/(home)/invite/[id]', params: { id: opts.serverId } });
}
