/**
 * The playback outbox. Progress made while the server cannot be reached
 * (offline playback of a download) is kept here, one entry per item, and
 * sent when the server answers again: the position, and the played state.
 *
 * The rules are pure and unit-tested; `createOutbox` adds the storage.
 */

export interface OutboxEntry {
  serverId: string;
  userId: string;
  itemId: string;
  positionTicks: number;
  runTimeTicks: number | null;
  /** The item was played to the end (or past the server's 90 % mark). */
  played: boolean;
  /** Epoch ms of the playback this entry records. */
  at: number;
  /** Failed sends in a row. */
  attempts: number;
  /** Epoch ms before which no send is tried again. */
  nextTryAt: number;
}

export const OUTBOX_SCHEMA_VERSION = 1;

export interface OutboxSnapshot {
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  entries: OutboxEntry[];
}

/** Jellyfin marks an item played past 90 % (its default MaxResumePct). */
export const PLAYED_FRACTION = 0.9;

export function keyOf(e: Pick<OutboxEntry, 'serverId' | 'userId' | 'itemId'>): string {
  return `${e.serverId}|${e.userId}|${e.itemId}`;
}

/** True when this position counts as played. */
export function isPlayedAt(positionTicks: number, runTimeTicks: number | null | undefined): boolean {
  return !!runTimeTicks && runTimeTicks > 0 && positionTicks >= runTimeTicks * PLAYED_FRACTION;
}

export interface OutboxInput {
  serverId: string;
  userId: string;
  itemId: string;
  positionTicks: number;
  runTimeTicks: number | null;
  played?: boolean;
  at: number;
}

/**
 * Adds a report. One entry per item: the newest playback wins, and a
 * "played" mark stays once set for the same playback.
 */
export function record(entries: readonly OutboxEntry[], input: OutboxInput): OutboxEntry[] {
  const played = input.played === true || isPlayedAt(input.positionTicks, input.runTimeTicks);
  const next: OutboxEntry = {
    serverId: input.serverId,
    userId: input.userId,
    itemId: input.itemId,
    positionTicks: played ? 0 : Math.max(0, Math.round(input.positionTicks)),
    runTimeTicks: input.runTimeTicks,
    played,
    at: input.at,
    attempts: 0,
    nextTryAt: 0,
  };
  const key = keyOf(next);
  const old = entries.find((e) => keyOf(e) === key);
  if (old && old.at > next.at) return [...entries];
  if (old && old.played && !next.played && next.at - old.at < 60_000) {
    // The end of the same playback: keep the played mark.
    next.played = true;
    next.positionTicks = 0;
  }
  return [...entries.filter((e) => keyOf(e) !== key), next];
}

/** 30 s, 2 min, 8 min … at most 1 h between tries for one entry. */
export function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 4 ** Math.max(0, attempts - 1));
}

/** Entries that may be sent now, oldest first. */
export function due(entries: readonly OutboxEntry[], now: number, scope?: { serverId: string; userId: string }): OutboxEntry[] {
  return entries
    .filter((e) => e.nextTryAt <= now && (!scope || (e.serverId === scope.serverId && e.userId === scope.userId)))
    .sort((a, b) => a.at - b.at);
}

export function markSent(entries: readonly OutboxEntry[], sent: OutboxEntry): OutboxEntry[] {
  // Only remove it when it was not replaced by a newer playback during the send.
  return entries.filter((e) => !(keyOf(e) === keyOf(sent) && e.at === sent.at));
}

export function markFailed(entries: readonly OutboxEntry[], failed: OutboxEntry, now: number): OutboxEntry[] {
  return entries.map((e) => {
    if (keyOf(e) !== keyOf(failed) || e.at !== failed.at) return e;
    const attempts = e.attempts + 1;
    return { ...e, attempts, nextTryAt: now + backoffMs(attempts) };
  });
}

export interface OutboxTransport {
  /** Sends the position and played state. Throws when the server cannot take it. */
  send(entry: OutboxEntry): Promise<void>;
}

export interface OutboxStore {
  read(): OutboxEntry[];
  write(entries: OutboxEntry[]): void;
}

/** Errors that mean "the server will never take this" (the item is gone): drop the entry. */
export type ErrorClass = 'retry' | 'drop';

/**
 * Sends every due entry, one at a time. Returns how many were sent. Stops at
 * the first network failure, since the others would fail the same way.
 */
export async function flush(
  store: OutboxStore,
  transport: OutboxTransport,
  opts: { now: () => number; classify: (e: unknown) => ErrorClass; scope?: { serverId: string; userId: string } },
): Promise<number> {
  let sent = 0;
  for (const entry of due(store.read(), opts.now(), opts.scope)) {
    try {
      await transport.send(entry);
      store.write(markSent(store.read(), entry));
      sent++;
    } catch (e) {
      if (opts.classify(e) === 'drop') {
        store.write(markSent(store.read(), entry));
        continue;
      }
      store.write(markFailed(store.read(), entry, opts.now()));
      break;
    }
  }
  return sent;
}

export function migrateOutbox(raw: unknown): OutboxEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const snap = raw as Partial<OutboxSnapshot>;
  if (snap.schemaVersion !== OUTBOX_SCHEMA_VERSION || !Array.isArray(snap.entries)) return [];
  return snap.entries.filter(
    (e): e is OutboxEntry =>
      !!e && typeof e === 'object' && typeof e.itemId === 'string' && typeof e.serverId === 'string' && typeof e.positionTicks === 'number',
  );
}

// ---- Routing by account ----------------------------------------------------------

export interface OutboxAccount {
  serverId: string;
  userId: string;
}

/** The accounts that have entries waiting, in the order of their oldest entry. */
export function pendingAccounts(entries: readonly OutboxEntry[]): OutboxAccount[] {
  const out: OutboxAccount[] = [];
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    if (!out.some((a) => a.serverId === e.serverId && a.userId === e.userId)) out.push({ serverId: e.serverId, userId: e.userId });
  }
  return out;
}

/**
 * Sends the entries of every account through that account's own transport.
 * `transportFor` returns null when the account's server does not answer (or
 * the account is not signed in here); its entries then stay. An entry never
 * goes through the transport of another account, so one server's progress
 * (and token) never reaches another server. Returns the count sent per account.
 */
export async function flushByAccount(
  store: OutboxStore,
  transportFor: (account: OutboxAccount) => Promise<OutboxTransport | null>,
  opts: { now: () => number; classify: (e: unknown) => ErrorClass },
): Promise<{ account: OutboxAccount; sent: number }[]> {
  const results: { account: OutboxAccount; sent: number }[] = [];
  for (const account of pendingAccounts(store.read())) {
    if (!due(store.read(), opts.now(), account).length) continue;
    const transport = await transportFor(account);
    if (!transport) continue;
    results.push({ account, sent: await flush(store, transport, { ...opts, scope: account }) });
  }
  return results;
}
