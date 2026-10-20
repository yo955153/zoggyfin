import { EXPIRED_KEEP_MS, expiredUsers, expiryOf, hasExpiredWork, inviteEntries, newRecord, pendingInvites, pruneRecords, type InviteRecord } from '../records';
import { INVITE_LIFETIME_MS } from '../payload';

jest.mock('@/storage/json', () => ({ readJson: jest.fn(), writeJson: jest.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T00:00:00Z');
const r = (userId: string, serverId = 's1', createdAt = '2026-10-01T00:00:00Z', extra: Partial<InviteRecord> = {}): InviteRecord => ({ serverId, userId, userName: userId, createdAt, ...extra });

describe('pendingInvites', () => {
  it('lists invites whose user exists and never signed in, newest first', () => {
    const records = [r('a', 's1', '2026-10-01T00:00:00Z'), r('b', 's1', '2026-10-02T00:00:00Z'), r('c'), r('d'), r('e', 's2')];
    const users = [{ Id: 'a' }, { Id: 'b', LastLoginDate: null }, { Id: 'c', LastLoginDate: '2026-10-03T00:00:00Z' }, { Id: 'e' }];
    expect(pendingInvites(records, 's1', users, NOW).map((x) => x.userId)).toEqual(['b', 'a']);
  });

  it('drops records of users that signed in or are gone, only on that server', () => {
    const records = [r('a'), r('c'), r('d'), r('e', 's2')];
    const users = [{ Id: 'a' }, { Id: 'c', LastActivityDate: '2026-10-03T00:00:00Z' }];
    expect(pruneRecords(records, 's1', users, NOW).map((x) => x.userId)).toEqual(['a', 'e']);
  });
});

describe('the 7-day expiry', () => {
  it('expires 7 days after the invite (also an older record with no expiry field)', () => {
    const rec = newRecord({ serverId: 's1', userId: 'a', userName: 'Jane' }, NOW);
    expect(expiryOf(rec)).toBe(NOW + 7 * DAY);
    expect(expiryOf(r('a'))).toBe(Date.parse('2026-10-01T00:00:00Z') + INVITE_LIFETIME_MS);
  });

  it('shows a pending invite until its expiry, then "expired"; the count has only pending ones', () => {
    const rec = r('a');
    const at = expiryOf(rec);
    expect(inviteEntries([rec], 's1', [{ Id: 'a' }], at - 1)).toEqual([{ record: rec, state: 'pending', expiresAt: at }]);
    expect(inviteEntries([rec], 's1', [{ Id: 'a' }], at)).toEqual([{ record: rec, state: 'expired', expiresAt: at }]);
    expect(pendingInvites([rec], 's1', [{ Id: 'a' }], at)).toEqual([]);
  });

  it('cleans up only users that never signed in, after the expiry', () => {
    const records = [r('a'), r('b'), r('c', 's1', '2026-10-04T00:00:00Z')];
    const users = [{ Id: 'a' }, { Id: 'b', LastLoginDate: '2026-10-02T00:00:00Z' }, { Id: 'c' }];
    const later = Date.parse('2026-10-09T00:00:00Z');
    expect(expiredUsers(records, 's1', users, later).map((x) => x.userId)).toEqual(['a']);
    expect(hasExpiredWork(records, 's1', later)).toBe(true);
    expect(hasExpiredWork(records, 's1', NOW)).toBe(false);
    expect(hasExpiredWork([r('a', 's1', '2026-10-01T00:00:00Z', { expired: true })], 's1', later)).toBe(false);
  });

  it('keeps an expired record after the cleanup (its user is gone) for 30 days, then drops it', () => {
    const rec = r('a', 's1', '2026-10-01T00:00:00Z', { expired: true });
    const at = expiryOf(rec);
    expect(inviteEntries([rec], 's1', [], at + 1)[0]?.state).toBe('expired');
    expect(pruneRecords([rec], 's1', [], at + EXPIRED_KEEP_MS - 1)).toEqual([rec]);
    expect(pruneRecords([rec], 's1', [], at + EXPIRED_KEEP_MS)).toEqual([]);
    // A user that is gone with no cleanup (deleted on the server) is not an expired invite.
    expect(inviteEntries([r('b')], 's1', [], at + 1)).toEqual([]);
  });
});
