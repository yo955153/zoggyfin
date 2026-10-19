
import { pendingInvites, pruneRecords, type InviteRecord } from '../records';

jest.mock('@/storage/json', () => ({ readJson: jest.fn(), writeJson: jest.fn() }));

const r = (userId: string, serverId = 's1', createdAt = '2026-10-01T00:00:00Z'): InviteRecord => ({ serverId, userId, userName: userId, createdAt });

describe('pendingInvites', () => {
  it('lists invites whose user exists and never signed in, newest first', () => {
    const records = [r('a', 's1', '2026-10-01T00:00:00Z'), r('b', 's1', '2026-10-02T00:00:00Z'), r('c'), r('d'), r('e', 's2')];
    const users = [{ Id: 'a' }, { Id: 'b', LastLoginDate: null }, { Id: 'c', LastLoginDate: '2026-10-03T00:00:00Z' }, { Id: 'e' }];
    expect(pendingInvites(records, 's1', users).map((x) => x.userId)).toEqual(['b', 'a']);
  });

  it('drops records of users that signed in or are gone, only on that server', () => {
    const records = [r('a'), r('c'), r('d'), r('e', 's2')];
    const users = [{ Id: 'a' }, { Id: 'c', LastActivityDate: '2026-10-03T00:00:00Z' }];
    expect(pruneRecords(records, 's1', users).map((x) => x.userId)).toEqual(['a', 'e']);
  });
});
