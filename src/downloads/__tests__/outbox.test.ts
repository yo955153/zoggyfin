import { backoffMs, due, flush, isPlayedAt, markFailed, markSent, migrateOutbox, OUTBOX_SCHEMA_VERSION, type OutboxEntry, type OutboxStore, record } from '../outbox';

const base = { serverId: 's', userId: 'u', runTimeTicks: 1000 };

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

describe('record', () => {
  it('keeps one entry per item, the newest wins', () => {
    let list = record([], { ...base, itemId: 'a', positionTicks: 100, at: 1 });
    list = record(list, { ...base, itemId: 'a', positionTicks: 300, at: 2 });
    list = record(list, { ...base, itemId: 'b', positionTicks: 50, at: 3 });
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.itemId === 'a')?.positionTicks).toBe(300);
    // An older report never replaces a newer one.
    list = record(list, { ...base, itemId: 'a', positionTicks: 10, at: 0 });
    expect(list.find((e) => e.itemId === 'a')?.positionTicks).toBe(300);
  });

  it('marks played past 90 % and clears the position', () => {
    const [e] = record([], { ...base, itemId: 'a', positionTicks: 950, at: 1 });
    expect(e?.played).toBe(true);
    expect(e?.positionTicks).toBe(0);
    expect(isPlayedAt(899, 1000)).toBe(false);
    expect(isPlayedAt(900, 1000)).toBe(true);
    expect(isPlayedAt(900, null)).toBe(false);
  });

  it('keeps the played mark for the end of the same playback', () => {
    let list = record([], { ...base, itemId: 'a', positionTicks: 999, at: 1000 });
    list = record(list, { ...base, itemId: 'a', positionTicks: 20, at: 2000 });
    expect(list[0]?.played).toBe(true);
    // A new playback much later is a new position.
    list = record(list, { ...base, itemId: 'a', positionTicks: 20, at: 200_000 });
    expect(list[0]?.played).toBe(false);
    expect(list[0]?.positionTicks).toBe(20);
  });

  it('takes an explicit played flag', () => {
    expect(record([], { ...base, itemId: 'a', positionTicks: 1, played: true, at: 1 })[0]?.played).toBe(true);
  });
});

describe('due, markSent and markFailed', () => {
  it('backs off failed entries and keeps the scope', () => {
    let list = record([], { ...base, itemId: 'a', positionTicks: 1, at: 1 });
    list = record(list, { ...base, serverId: 'other', itemId: 'b', positionTicks: 1, at: 2 });
    expect(due(list, 0).map((e) => e.itemId)).toEqual(['a', 'b']);
    expect(due(list, 0, { serverId: 's', userId: 'u' }).map((e) => e.itemId)).toEqual(['a']);
    const failed = markFailed(list, list[0]!, 100);
    expect(failed[0]?.attempts).toBe(1);
    expect(failed[0]?.nextTryAt).toBe(100 + backoffMs(1));
    expect(due(failed, 101).map((e) => e.itemId)).toEqual(['b']);
    expect(markSent(failed, failed[0]!)).toHaveLength(1);
  });

  it('does not remove an entry replaced during the send', () => {
    const list = record([], { ...base, itemId: 'a', positionTicks: 1, at: 1 });
    const newer = record(list, { ...base, itemId: 'a', positionTicks: 2, at: 5 });
    expect(markSent(newer, list[0]!)).toHaveLength(1);
  });

  it('grows the backoff to at most an hour', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});

describe('flush', () => {
  const opts = { now: () => 1000, classify: () => 'retry' as const };

  it('sends every due entry, oldest first, and empties the outbox', async () => {
    const store = memoryStore(record(record([], { ...base, itemId: 'b', positionTicks: 2, at: 2 }), { ...base, itemId: 'a', positionTicks: 1, at: 1 }));
    const sent: string[] = [];
    const n = await flush(store, { send: async (e) => void sent.push(e.itemId) }, opts);
    expect(n).toBe(2);
    expect(sent).toEqual(['a', 'b']);
    expect(store.entries).toEqual([]);
  });

  it('stops at the first network failure and keeps the rest', async () => {
    const store = memoryStore(record(record([], { ...base, itemId: 'a', positionTicks: 1, at: 1 }), { ...base, itemId: 'b', positionTicks: 2, at: 2 }));
    let calls = 0;
    const n = await flush(
      store,
      {
        send: async () => {
          calls++;
          throw new Error('Network Error');
        },
      },
      opts,
    );
    expect(n).toBe(0);
    expect(calls).toBe(1);
    expect(store.entries).toHaveLength(2);
    expect(store.entries.find((e) => e.itemId === 'a')?.attempts).toBe(1);
  });

  it('drops entries the server will never take', async () => {
    const store = memoryStore(record([], { ...base, itemId: 'gone', positionTicks: 1, at: 1 }));
    const n = await flush(
      store,
      {
        send: async () => {
          throw new Error('404');
        },
      },
      { now: () => 1000, classify: () => 'drop' },
    );
    expect(n).toBe(0);
    expect(store.entries).toEqual([]);
  });
});

describe('migrateOutbox', () => {
  it('reads only the current schema', () => {
    const entries = record([], { ...base, itemId: 'a', positionTicks: 1, at: 1 });
    expect(migrateOutbox({ schemaVersion: OUTBOX_SCHEMA_VERSION, entries })).toEqual(entries);
    expect(migrateOutbox({ schemaVersion: 0, entries })).toEqual([]);
    expect(migrateOutbox(null)).toEqual([]);
    expect(migrateOutbox({ schemaVersion: OUTBOX_SCHEMA_VERSION, entries: [{ nope: 1 }] })).toEqual([]);
  });
});
