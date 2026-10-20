import { cleanExpiredInvites } from '../cleanup';
import type { InviteRecord } from '../records';

let mockStored: InviteRecord[] = [];
jest.mock('@/storage/json', () => ({
  readJson: () => mockStored,
  writeJson: (_k: string, v: InviteRecord[]) => {
    mockStored = v;
  },
}));
const mockUsers: { Id: string; LastLoginDate?: string }[] = [];
const mockDeleted: string[] = [];
jest.mock('../api', () => ({
  getUsers: async () => mockUsers,
  deleteUser: async (_api: unknown, id: string) => {
    mockDeleted.push(id);
  },
}));

const DAY = 24 * 60 * 60 * 1000;
const made = Date.parse('2026-10-01T00:00:00Z');
const rec = (userId: string, extra: Partial<InviteRecord> = {}): InviteRecord => ({
  serverId: 's1',
  userId,
  userName: userId,
  createdAt: new Date(made).toISOString(),
  expiresAt: new Date(made + 7 * DAY).toISOString(),
  ...extra,
});

beforeEach(() => {
  mockStored = [];
  mockUsers.length = 0;
  mockDeleted.length = 0;
});

describe('cleanExpiredInvites', () => {
  it('does nothing (no server call) while no invite is past its expiry', async () => {
    mockStored = [rec('a')];
    expect(await cleanExpiredInvites({} as never, 's1', made + 6 * DAY)).toBe(0);
    expect(mockDeleted).toEqual([]);
  });

  it('deletes the user of an expired invite that never signed in, and keeps the record as expired', async () => {
    mockStored = [rec('a'), rec('b'), rec('c', { serverId: 's2' })];
    mockUsers.push({ Id: 'a' }, { Id: 'b', LastLoginDate: '2026-10-02T00:00:00Z' });
    expect(await cleanExpiredInvites({} as never, 's1', made + 8 * DAY)).toBe(1);
    expect(mockDeleted).toEqual(['a']);
    // b joined: its record goes. The other server's record stays as it was.
    expect(mockStored.map((r) => [r.userId, !!r.expired])).toEqual([
      ['a', true],
      ['c', false],
    ]);
    // A second run has nothing to do.
    expect(await cleanExpiredInvites({} as never, 's1', made + 9 * DAY)).toBe(0);
  });
});
