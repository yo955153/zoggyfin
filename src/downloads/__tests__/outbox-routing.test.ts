import { flushByAccount, type OutboxAccount, type OutboxEntry, type OutboxStore, pendingAccounts, record } from '../outbox';
import { outboxOnly, isForeignDownload } from '../../player/outbox-transport';

jest.mock('@/lib/online', () => ({ isOffline: () => false, reportNetworkError: () => undefined }));

const mockAdded: unknown[] = [];
jest.mock('@/downloads/outbox-store', () => ({
  addToOutbox: (e: unknown) => mockAdded.push(e),
  clearOutboxFor: () => undefined,
}));

function memoryStore(initial: OutboxEntry[] = []): OutboxStore & { entries: OutboxEntry[] } {
  const store = {
    entries: initial,
    read: () => store.entries,
    write: (e: OutboxEntry[]) => {
      store.entries = e;
    },
  };
  return store;
}

const A = { serverId: 'server-a', userId: 'user-1' };
const B = { serverId: 'server-b', userId: 'user-2' };
const A2 = { serverId: 'server-a', userId: 'user-3' };

function entries(): OutboxEntry[] {
  let list: OutboxEntry[] = [];
  list = record(list, { ...A, itemId: 'a1', positionTicks: 10, runTimeTicks: 1000, at: 3 });
  list = record(list, { ...B, itemId: 'b1', positionTicks: 20, runTimeTicks: 1000, at: 1 });
  list = record(list, { ...A2, itemId: 'a2', positionTicks: 30, runTimeTicks: 1000, at: 2 });
  list = record(list, { ...B, itemId: 'b2', positionTicks: 40, runTimeTicks: 1000, at: 4 });
  return list;
}

const opts = { now: () => 10, classify: () => 'retry' as const };

describe('outbox routing by account', () => {
  it('lists the accounts with waiting entries, oldest first', () => {
    expect(pendingAccounts(entries())).toEqual([B, A2, A]);
  });

  it('sends each entry only through its own account', async () => {
    const store = memoryStore(entries());
    const sent: Record<string, string[]> = {};
    const result = await flushByAccount(
      store,
      async (acc: OutboxAccount) => ({
        send: async (e) => {
          // A transport must never see an entry of another account.
          expect(e.serverId).toBe(acc.serverId);
          expect(e.userId).toBe(acc.userId);
          (sent[`${acc.serverId}/${acc.userId}`] ??= []).push(e.itemId);
        },
      }),
      opts,
    );
    expect(sent).toEqual({ 'server-b/user-2': ['b1', 'b2'], 'server-a/user-3': ['a2'], 'server-a/user-1': ['a1'] });
    expect(result.map((r) => r.sent)).toEqual([2, 1, 1]);
    expect(store.entries).toEqual([]);
  });

  it('keeps the entries of a server that does not answer, and sends the others', async () => {
    const store = memoryStore(entries());
    const result = await flushByAccount(store, async (acc) => (acc.serverId === 'server-b' ? null : { send: async () => undefined }), opts);
    expect(result.map((r) => r.account.serverId)).toEqual(['server-a', 'server-a']);
    expect(store.entries.map((e) => e.itemId).sort()).toEqual(['b1', 'b2']);
  });

  it('stops one account at a network failure without touching the next one', async () => {
    const store = memoryStore(entries());
    await flushByAccount(
      store,
      async (acc) => ({
        send: async () => {
          if (acc.serverId === 'server-b') throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
        },
      }),
      opts,
    );
    const left = store.entries.map((e) => e.itemId).sort();
    expect(left).toEqual(['b1', 'b2']);
    expect(store.entries.find((e) => e.itemId === 'b1')?.attempts).toBe(1);
  });
});

describe('progress of another server\'s download', () => {
  it('goes only into the outbox, tagged with that server and user', async () => {
    mockAdded.length = 0;
    const t = outboxOnly({ serverId: 'server-b', userId: 'user-2', runTimeTicks: 1000 });
    const report = { itemId: 'b1', mediaSourceId: 'b1', playSessionId: null, positionTicks: 400, playMethod: 'DirectPlay' as const, canSeek: true, isPaused: false, isMuted: false, playbackRate: 1, audioStreamIndex: null, subtitleStreamIndex: null };
    await t.start(report);
    await t.progress(report, 'TimeUpdate');
    await t.stopped(report);
    expect(mockAdded).toHaveLength(2);
    expect(mockAdded[0]).toMatchObject({ serverId: 'server-b', userId: 'user-2', itemId: 'b1', positionTicks: 400 });
  });

  it('knows a download of another server', () => {
    expect(isForeignDownload({ serverId: 'server-b' }, 'server-a')).toBe(true);
    expect(isForeignDownload({ serverId: 'server-a' }, 'server-a')).toBe(false);
    expect(isForeignDownload({ serverId: '' }, 'server-a')).toBe(false);
  });
});
