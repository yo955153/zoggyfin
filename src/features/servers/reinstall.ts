/**
 * A server that came back with a new Id (Jellyfin makes a new Id on a fresh
 * install). When the user adds a server with the name or an address of a
 * saved one, the app asks if it is the same server. On Yes, after the sign-in,
 * the new server takes the old addresses and the downloads move over.
 */
import { Alert, Platform } from 'react-native';

import { getApi } from '@/api/client';
import { useSessionStore } from '@/auth/session-store';
import { reinstallCandidate } from '@/auth/server-identity';
import { downloadsOf, moveDownloadsToServer } from '@/downloads/move-server';
import { toast } from '@/lib/toast';

function ask(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'No', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Yes', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

/** Asks when the new server looks like a saved one. Returns the old server Id on Yes, else null. */
export async function askIfReinstalled(info: { id: string; name: string; url: string }): Promise<string | null> {
  const old = reinstallCandidate(useSessionStore.getState().accounts, info);
  if (!old) return null;
  const n = downloadsOf(old.id);
  const message = n
    ? `Is this the same server as ${old.name}? Your downloads from it can move over.`
    : `Is this the same server as ${old.name}? It then keeps the addresses and settings of ${old.name}.`;
  return (await ask('Same server?', message)) ? old.id : null;
}

/** After the sign-in to the new server: moves the downloads and the addresses, then tells the result. */
export async function finishReinstall(oldId: string, to: { url: string; token: string; serverId: string; userId: string }): Promise<void> {
  let moved = 0;
  let total = 0;
  try {
    ({ moved, total } = await moveDownloadsToServer(getApi(to.url, to.token), oldId, { serverId: to.serverId, userId: to.userId }));
  } catch {
    total = downloadsOf(oldId);
  }
  useSessionStore.getState().adoptServer(oldId, to.serverId, total - moved > 0);
  if (total) toast(`Moved ${moved} of ${total} downloads`, { icon: 'arrow.down.circle' });
}
