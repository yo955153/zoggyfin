import { buildInvitePolicy, DEFAULT_OPTIONS, makeOneTimePassword, PASSWORD_ALPHABET, PASSWORD_LENGTH, usernameFor } from '../policy';

const base = {
  AuthenticationProviderId: 'auth',
  PasswordResetProviderId: 'reset',
  IsAdministrator: true,
  EnableAllFolders: true,
  EnableMediaPlayback: true,
  MaxActiveSessions: 3,
};

describe('buildInvitePolicy', () => {
  it('keeps the server defaults and never makes an administrator', () => {
    const p = buildInvitePolicy(base, DEFAULT_OPTIONS);
    expect(p.IsAdministrator).toBe(false);
    expect(p.IsDisabled).toBe(false);
    expect(p.EnableMediaPlayback).toBe(true);
    expect(p.MaxActiveSessions).toBe(3);
    expect(p.AuthenticationProviderId).toBe('auth');
    expect(p.PasswordResetProviderId).toBe('reset');
    expect(p.EnableAllFolders).toBe(true);
    expect(p.EnabledFolders).toEqual([]);
    expect(p.EnableContentDownloading).toBe(true);
    expect(p.EnableRemoteAccess).toBe(true);
    expect(p.EnableContentDeletion).toBe(false);
  });

  it('limits the libraries and turns options off', () => {
    const p = buildInvitePolicy(base, { libraryIds: ['a', 'b', 'a'], allowDownloads: false, allowRemote: false });
    expect(p.EnableAllFolders).toBe(false);
    expect(p.EnabledFolders).toEqual(['a', 'b']);
    expect(p.EnableContentDownloading).toBe(false);
    expect(p.EnableRemoteAccess).toBe(false);
  });

  it('fills the provider Ids that Jellyfin requires', () => {
    const p = buildInvitePolicy(null, DEFAULT_OPTIONS);
    expect(p.AuthenticationProviderId).toMatch(/DefaultAuthenticationProvider$/);
    expect(p.PasswordResetProviderId).toMatch(/DefaultPasswordResetProvider$/);
  });
});

describe('makeOneTimePassword', () => {
  it('uses only the alphabet and has the full length', () => {
    let i = 0;
    const pw = makeOneTimePassword((n) => Uint8Array.from({ length: n }, () => i++ % 256));
    expect(pw).toHaveLength(PASSWORD_LENGTH);
    for (const ch of pw) expect(PASSWORD_ALPHABET).toContain(ch);
  });

  it('drops bytes that would make some characters more likely', () => {
    const limit = 256 - (256 % PASSWORD_ALPHABET.length);
    const pw = makeOneTimePassword((n) => Uint8Array.from({ length: n }, (_, k) => (k % 2 ? 255 : limit - 1)), 4);
    expect(pw).toBe(PASSWORD_ALPHABET[(limit - 1) % PASSWORD_ALPHABET.length].repeat(4));
  });

  it('throws when the random source gives nothing usable', () => {
    expect(() => makeOneTimePassword((n) => new Uint8Array(n).fill(255))).toThrow();
  });
});

describe('usernameFor', () => {
  it('keeps letters, numbers and simple marks', () => {
    expect(usernameFor('  Jane   Doe ')).toBe('Jane Doe');
    expect(usernameFor('Sam <script>')).toBe('Sam script');
    expect(usernameFor('سارة')).toBe('سارة');
    expect(usernameFor('!!!')).toBe('');
  });
});
