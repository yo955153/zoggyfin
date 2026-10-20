/**
 * Expired invites: the admin's app deletes each invited user that never
 * signed in once its invite is past `INVITE_DAYS` (records.ts). Jellyfin has
 * no account expiry, so this is what makes an old link (and its one-time
 * password) stop working on the server, also in other Jellyfin apps. It
 * runs when an admin opens the app or the invite screen, and only when this
 * device has a record that is past its expiry.
 */
import type { Api } from '@jellyfin/sdk';

import { deleteUser, getUsers } from './api';
import { expiredUsers, hasExpiredWork, markExpired, pruneRecords, readRecords, writeRecords } from './records';

/** Returns the number of users it deleted. A failure (not an admin, offline) changes nothing; the next run tries again. */
export async function cleanExpiredInvites(api: Api, serverId: string, now = Date.now()): Promise<number> {
  if (!hasExpiredWork(readRecords(), serverId, now)) return 0;
  let users;
  try {
    users = await getUsers(api);
  } catch {
    return 0;
  }
  let deleted = 0;
  for (const r of expiredUsers(readRecords(), serverId, users, now)) {
    try {
      await deleteUser(api, r.userId);
      markExpired(serverId, r.userId);
      deleted += 1;
    } catch {
      // The next run tries again.
    }
  }
  writeRecords(pruneRecords(readRecords(), serverId, users, now));
  return deleted;
}
