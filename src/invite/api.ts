/**
 * The Jellyfin calls of invites. Admin side: create the user, set its policy,
 * list the libraries and users, set a new one-time password, delete the user.
 * Person side: change the one-time password.
 */
import type { Api } from '@jellyfin/sdk';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';

import { buildInvitePolicy, type InviteOptions } from './policy';

export interface Library {
  id: string;
  name: string;
}

export async function isAdministrator(api: Api): Promise<boolean> {
  const me = (await getUserApi(api).getCurrentUser()).data;
  return me.Policy?.IsAdministrator === true;
}

/** The server's libraries (media folders). Admin only. */
export async function getLibraries(api: Api): Promise<Library[]> {
  const res = (await getLibraryApi(api).getMediaFolders({ isHidden: false })).data;
  return (res.Items ?? []).filter((i) => i.Id).map((i) => ({ id: i.Id as string, name: i.Name ?? 'Library' }));
}

export async function getUsers(api: Api): Promise<UserDto[]> {
  return (await getUserApi(api).getUsers()).data;
}

/** Creates the user with the one-time password, then sets the invite policy. Deletes the user again when the policy fails. */
export async function createInvitedUser(api: Api, name: string, password: string, opts: InviteOptions): Promise<UserDto> {
  const users = getUserApi(api);
  const user = (await users.createUserByName({ createUserByName: { Name: name, Password: password } })).data;
  if (!user.Id) throw new Error('The server did not return the new user.');
  try {
    await users.updateUserPolicy({ userId: user.Id, userPolicy: buildInvitePolicy(user.Policy, opts) });
  } catch (e) {
    await users.deleteUser({ userId: user.Id }).catch(() => undefined);
    throw e;
  }
  return user;
}

/** An admin sets a new password for another user (Resend). Jellyfin does not ask an admin for the old one. */
export async function setPasswordAsAdmin(api: Api, userId: string, password: string): Promise<void> {
  await getUserApi(api).updateUserPassword({ userId, updateUserPassword: { NewPw: password, ResetPassword: false } });
}

export async function deleteUser(api: Api, userId: string): Promise<void> {
  await getUserApi(api).deleteUser({ userId });
}

/** The person changes the one-time password to their own. */
export async function changeOwnPassword(api: Api, userId: string, current: string, next: string): Promise<void> {
  await getUserApi(api).updateUserPassword({ userId, updateUserPassword: { CurrentPw: current, NewPw: next } });
}
