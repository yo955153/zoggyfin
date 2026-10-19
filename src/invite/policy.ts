/**
 * The user policy for a person added by invite, and the one-time password.
 * Pure, so it is unit-tested.
 */
import type { UserPolicy } from '@jellyfin/sdk/lib/generated-client/models';

export interface InviteOptions {
  /** Null: all libraries, also libraries that the admin adds later. */
  libraryIds: string[] | null;
  allowDownloads: boolean;
  allowRemote: boolean;
}

export const DEFAULT_OPTIONS: InviteOptions = { libraryIds: null, allowDownloads: true, allowRemote: true };

const DEFAULT_AUTH_PROVIDER = 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider';
const DEFAULT_RESET_PROVIDER = 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider';

/**
 * The body of `POST /Users/{id}/Policy`. Jellyfin replaces the whole policy,
 * so this starts from the policy the server gave the new user and changes
 * only the invite options. The person is never an administrator.
 */
export function buildInvitePolicy(base: UserPolicy | null | undefined, opts: InviteOptions): UserPolicy {
  const all = opts.libraryIds === null;
  return {
    ...(base ?? {}),
    AuthenticationProviderId: base?.AuthenticationProviderId || DEFAULT_AUTH_PROVIDER,
    PasswordResetProviderId: base?.PasswordResetProviderId || DEFAULT_RESET_PROVIDER,
    IsAdministrator: false,
    IsDisabled: false,
    // Not on the server's public sign-in screen: the person signs in with the invite.
    IsHidden: true,
    EnableAllFolders: all,
    EnabledFolders: all ? [] : [...new Set(opts.libraryIds)],
    EnableContentDownloading: opts.allowDownloads,
    EnableRemoteAccess: opts.allowRemote,
    EnableContentDeletion: false,
    EnableContentDeletionFromFolders: [],
    EnableRemoteControlOfOtherUsers: false,
    EnableSharedDeviceControl: false,
    EnableCollectionManagement: false,
    EnableSubtitleManagement: false,
  };
}

/** No 0/O, 1/l/I: the person can read the password aloud if they must. */
export const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const PASSWORD_LENGTH = 24;

/**
 * A one-time password from a secure random source (about 140 bits). Bytes
 * above the largest multiple of the alphabet size are dropped, so every
 * character is equally likely.
 */
export function makeOneTimePassword(randomBytes: (n: number) => Uint8Array, length = PASSWORD_LENGTH): string {
  const n = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  for (let guard = 0; out.length < length && guard < 64; guard++) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit) out += PASSWORD_ALPHABET[b % n];
      if (out.length === length) break;
    }
  }
  if (out.length < length) throw new Error('The random source does not work.');
  return out;
}

/**
 * The Jellyfin username for a name: trimmed, inner spaces kept, characters
 * that Jellyfin refuses removed. Empty when nothing is left.
 */
export function usernameFor(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _.'@+-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}
