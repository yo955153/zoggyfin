/**
 * The outbox on the device (MMKV), and the transport that sends it to the
 * server. Flushed when the server is reachable again.
 */
import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryClient } from '@/api/query-client';
import { queryKeys } from '@/api/query-keys';
import { useSessionStore } from '@/auth/session-store';
import { readJson, writeJson } from '@/storage/json';

import {
  flush,
  keyOf,
  migrateOutbox,
  OUTBOX_SCHEMA_VERSION,
  type OutboxEntry,
  type OutboxInput,
  type OutboxStore,
  record,
} from './outbox';

const KEY = 'downloads.outbox';

export const outboxStore: OutboxStore = {
  read: () => migrateOutbox(readJson<unknown>(KEY, null)),
  write: (entries) => writeJson(KEY, { schemaVersion: OUTBOX_SCHEMA_VERSION, entries }),
};

export function addToOutbox(input: OutboxInput): void {
  outboxStore.write(record(outboxStore.read(), input));
}

/** The server got a newer report for this item: drop what waits for it. */
export function clearOutboxFor(serverId: string, userId: string, itemId: string): void {
  const key = keyOf({ serverId, userId, itemId });
  const entries = outboxStore.read();
  if (entries.some((e) => keyOf(e) === key)) outboxStore.write(entries.filter((e) => keyOf(e) !== key));
}

export function outboxSize(): number {
  return outboxStore.read().length;
}

let running: Promise<number> | null = null;

/** Sends what waits for the signed-in account. Returns how many entries were sent. */
export function flushOutbox(): Promise<number> {
  const s = useSessionStore.getState().session;
  if (!s) return Promise.resolve(0);
  if (running) return running;
  const api = getApi(s.serverUrl, s.token);
  const sentItems: string[] = [];
  running = flush(
    outboxStore,
    {
      send: async (e: OutboxEntry) => {
        await jf.updatePlayState(api, e.userId, e.itemId, { positionTicks: e.positionTicks, played: e.played, at: e.at });
        sentItems.push(e.itemId);
      },
    },
    {
      now: Date.now,
      classify: (e) => {
        const kind = describeError(e).kind;
        return kind === 'notFound' || kind === 'forbidden' ? 'drop' : 'retry';
      },
      scope: { serverId: s.serverId, userId: s.userId },
    },
  )
    .then((n) => {
      if (n > 0) {
        const scope = { serverId: s.serverId, userId: s.userId };
        void queryClient.invalidateQueries({ queryKey: queryKeys.resume(scope, 'Video') });
        void queryClient.invalidateQueries({ queryKey: queryKeys.resume(scope, 'Audio') });
        for (const id of sentItems) void queryClient.invalidateQueries({ queryKey: queryKeys.item(scope, id) });
        if (__DEV__) console.log(`[outbox] sent ${n} offline play report(s)`);
      }
      return n;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
