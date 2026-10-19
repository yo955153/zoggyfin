/**
 * The outbox on the device (MMKV), and the transports that send it. Each
 * entry carries its server Id and user Id and goes only to that account's
 * server, when that server answers.
 */
import type { Api } from '@jellyfin/sdk';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryClient } from '@/api/query-client';
import { queryKeys } from '@/api/query-keys';
import { findUser } from '@/auth/accounts';
import { tokenFor, useSessionStore } from '@/auth/session-store';
import { isOffline } from '@/lib/online';
import { checkConnection, connectionOf } from '@/servers/connection';
import { readJson, writeJson } from '@/storage/json';

import {
  flushByAccount,
  keyOf,
  migrateOutbox,
  OUTBOX_SCHEMA_VERSION,
  type OutboxEntry,
  type OutboxAccount,
  type OutboxInput,
  type OutboxStore,
  type OutboxTransport,
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

function transportOf(api: Api): OutboxTransport {
  return {
    send: async (e: OutboxEntry) => {
      await jf.updatePlayState(api, e.userId, e.itemId, { positionTicks: e.positionTicks, played: e.played, at: e.at });
    },
  };
}

/**
 * The transport of one account, or null when its server does not answer now.
 * The active account uses the address in use. Another account's server is
 * probed in the background (its addresses, with the server Id check), and
 * the active account does not change.
 */
async function accountTransport(account: OutboxAccount): Promise<OutboxTransport | null> {
  const st = useSessionStore.getState();
  const s = st.session;
  if (s && s.serverId === account.serverId && s.userId === account.userId) {
    return isOffline() ? null : transportOf(getApi(s.serverUrl, s.token));
  }
  if (!findUser(st.accounts, account)) return null;
  const token = tokenFor(account);
  if (!token) return null;
  // The same server as the active account (another user): its address is already checked.
  const url = s && s.serverId === account.serverId ? (isOffline() ? null : s.serverUrl) : (await checkConnection(account.serverId)) ? connectionOf(account.serverId).url : null;
  return url ? transportOf(getApi(url, token)) : null;
}

/**
 * Sends what waits in the outbox, for every account on this device, each to
 * its own server. Returns how many entries were sent.
 */
export function flushOutbox(): Promise<number> {
  if (running) return running;
  running = flushByAccount(outboxStore, accountTransport, {
    now: Date.now,
    classify: (e) => {
      const kind = describeError(e).kind;
      return kind === 'notFound' || kind === 'forbidden' ? 'drop' : 'retry';
    },
  })
    .then((results) => {
      let total = 0;
      for (const { account, sent } of results) {
        total += sent;
        if (sent > 0) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.resume(account, 'Video') });
          void queryClient.invalidateQueries({ queryKey: queryKeys.resume(account, 'Audio') });
          void queryClient.invalidateQueries({ queryKey: [...queryKeys.all(account), 'item'] });
        }
      }
      if (__DEV__ && total) console.log(`[outbox] sent ${total} offline play report(s)`);
      return total;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** True when entries of an account other than the active one wait (their server is probed in the background). */
export function hasOtherAccountEntries(): boolean {
  const s = useSessionStore.getState().session;
  return outboxStore.read().some((e) => !s || e.serverId !== s.serverId || e.userId !== s.userId);
}
