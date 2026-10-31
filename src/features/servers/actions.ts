/**
 * Account and server actions that more than one screen uses: switch to an
 * account, add a server or a user, sign one user out, remove a server.
 */
import { router } from 'expo-router';
import { Alert, Platform } from 'react-native';

import { dropApi, getApi } from '@/api/client';
import { logout } from '@/api/jellyfin';
import { type AccountRef, findServer, findUser, startUrl } from '@/auth/accounts';
import { tokenFor, useSessionStore } from '@/auth/session-store';
import { downloadsState } from '@/downloads/store';
import { removeServerDownloads } from '@/downloads';
import { confirmDestructive } from '@/lib/confirm';
import { toast } from '@/lib/toast';
import { activePlayback, usePlayerStore } from '@/player';

/** Tells the server that a token ends, but never lets a dead server hold the user up. */
async function endOnServer(ref: AccountRef): Promise<void> {
  const st = useSessionStore.getState();
  const server = findServer(st.accounts, ref.serverId);
  const token = tokenFor(ref);
  const s = st.session;
  const url = s && s.serverId === ref.serverId ? s.serverUrl : server ? startUrl(server) : null;
  if (!url || !token) return;
  const api = getApi(url, token);
  await Promise.race([logout(api).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  dropApi(url, token);
}

/** Playback of one account must not report to another: it stops before a switch. */
function stopPlayback(): void {
  if (usePlayerStore.getState().now) activePlayback.stop();
}

/** Makes a saved account active. With no token on this device, it opens the sign-in for that server. */
export function switchAccount(ref: AccountRef): void {
  const st = useSessionStore.getState();
  const s = st.session;
  if (s && s.serverId === ref.serverId && s.userId === ref.userId) return;
  const server = findServer(st.accounts, ref.serverId);
  const user = findUser(st.accounts, ref);
  if (!server || !user) return;
  stopPlayback();
  if (!st.switchTo(ref)) {
    toast(`Sign in to ${server.name} again.`);
    openAddUser(ref.serverId);
    return;
  }
  router.dismissTo('/(tabs)/(home)');
  toast(`${user.userName} on ${server.name}`, { icon: 'checkmark' });
}

/** The sign-in flow for a new server, over the signed-in app. */
export function openAddServer(): void {
  router.push('/add-account');
}

/** The sign-in screen for another user (or the same user again) on a saved server. */
export function openAddUser(serverId: string): void {
  const st = useSessionStore.getState();
  const server = findServer(st.accounts, serverId);
  if (!server) return;
  const url = st.session?.serverId === serverId ? st.session.serverUrl : startUrl(server);
  if (!url) return;
  router.push({
    pathname: '/add-account/login',
    params: { url, serverId: server.id, serverName: server.name, version: server.version ?? '' },
  });
}

/** Signs one user out, after a confirm. Another saved account becomes active when it was the active one. */
export async function signOutUser(ref: AccountRef): Promise<void> {
  const st = useSessionStore.getState();
  const server = findServer(st.accounts, ref.serverId);
  const user = findUser(st.accounts, ref);
  if (!server || !user) return;
  if (!(await confirmDestructive(`Sign ${user.userName} out?`, `${user.userName} will be signed out of ${server.name} on this device.`, 'Sign out'))) return;
  const active = st.session?.serverId === ref.serverId && st.session.userId === ref.userId;
  if (active) stopPlayback();
  await endOnServer(ref);
  useSessionStore.getState().removeUser(ref);
}

type Choice = 'cancel' | 'keep' | 'delete';

function askDownloads(name: string, count: number): Promise<Choice> {
  const message = `${count} ${count === 1 ? 'download' : 'downloads'} of ${name} are on this device.`;
  if (Platform.OS === 'web') {
    // Web has no downloads; this branch is for completeness.
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${message}\n\nDelete them too?`) ? 'delete' : 'keep');
  }
  return new Promise((resolve) =>
    Alert.alert('Delete the downloads too?', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
      { text: 'Keep downloads', onPress: () => resolve('keep') },
      { text: 'Delete downloads', style: 'destructive', onPress: () => resolve('delete') },
    ], { cancelable: true, onDismiss: () => resolve('cancel') }),
  );
}

/** Removes a server and signs all its users out, after a confirm. Offers to delete its downloads. True when removed. */
export async function removeServerFlow(serverId: string): Promise<boolean> {
  const st = useSessionStore.getState();
  const server = findServer(st.accounts, serverId);
  if (!server) return false;
  const users = server.users.length;
  if (
    !(await confirmDestructive(
      `Remove ${server.name}?`,
      users ? `All ${users === 1 ? 'users' : `${users} users`} of this server will be signed out on this device.` : 'The server and its addresses will be removed from this device.',
      'Remove',
    ))
  ) {
    return false;
  }
  const count = Object.values(downloadsState().records).filter((r) => r.serverId === serverId).length;
  const choice: Choice = count ? await askDownloads(server.name, count) : 'keep';
  if (choice === 'cancel') return false;
  if (st.session?.serverId === serverId) stopPlayback();
  await Promise.all(server.users.map((u) => endOnServer({ serverId, userId: u.userId })));
  useSessionStore.getState().removeServer(serverId);
  if (choice === 'delete') await removeServerDownloads(serverId);
  toast(`${server.name} was removed`, { icon: 'checkmark' });
  return true;
}
