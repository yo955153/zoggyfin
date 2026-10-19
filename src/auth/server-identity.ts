/**
 * One server stays one saved server when its address changes, and the app
 * notices a server that came back with a new Id after a reinstall. Pure
 * functions over the saved accounts, unit-tested.
 */
import { guessKind, sameServerId, sameUrl, type ServerAddress } from '@/servers/addresses';

import { type AccountsData, findServer, removeServer, type SavedServer, updateServer } from './accounts';

/** The app writes `lastOkAt` at most this often per address, so a check does not save the accounts each time. */
export const REACHED_EVERY_MS = 60 * 60 * 1000;
/** An address that has not answered for this long shows "Not reached since <date>". */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Adds the addresses that discovery found for saved servers (same Id). A new
 * address goes at the end, marked `found`: the user's own addresses keep
 * their order, and the found one takes over when they do not answer.
 * Returns the same object when nothing changed.
 */
export function learnAddresses(data: AccountsData, found: readonly { serverId: string; url: string }[], at: number): AccountsData {
  let next = data;
  for (const f of found) {
    const server = findServer(next, f.serverId);
    if (!server) continue;
    const i = server.addresses.findIndex((a) => sameUrl(a.url, f.url));
    if (i >= 0) {
      // Known address: discovery reached it just now.
      const a = server.addresses[i];
      if (a.lastOkAt && at - a.lastOkAt < REACHED_EVERY_MS) continue;
      const addresses = server.addresses.slice();
      addresses[i] = { ...a, lastOkAt: at };
      next = updateServer(next, server.id, { addresses });
      continue;
    }
    const added: ServerAddress = { url: f.url, kind: guessKind(f.url), found: true, lastOkAt: at };
    next = updateServer(next, server.id, { addresses: [...server.addresses, added] });
  }
  return next;
}

/** Notes that `url` answered as the server. Returns the same object when the last note is recent. */
export function markReached(data: AccountsData, serverId: string, url: string, at: number): AccountsData {
  const server = findServer(data, serverId);
  if (!server) return data;
  const i = server.addresses.findIndex((a) => sameUrl(a.url, url));
  if (i < 0) return data;
  const a = server.addresses[i];
  if (a.lastOkAt && at - a.lastOkAt < REACHED_EVERY_MS) return data;
  const addresses = server.addresses.slice();
  addresses[i] = { ...a, lastOkAt: at };
  return updateServer(data, server.id, { addresses });
}

/** The time of the last answer when the address is stale, else null. An address with no record yet is not stale. */
export function staleSince(a: ServerAddress, now: number): number | null {
  return a.lastOkAt !== undefined && now - a.lastOkAt > STALE_AFTER_MS ? a.lastOkAt : null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A saved server that is likely the same machine as a new server with a
 * different Id (Jellyfin makes a new Id on a fresh install): the same
 * address first, then the same name. Null when the Id is known already.
 */
export function reinstallCandidate(data: AccountsData, info: { id: string; name: string; url: string }): SavedServer | null {
  if (findServer(data, info.id)) return null;
  const others = data.servers.filter((s) => !sameServerId(s.id, info.id));
  return (
    others.find((s) => s.addresses.some((a) => sameUrl(a.url, info.url))) ??
    (info.name.trim() ? others.find((s) => sameName(s.name, info.name)) : undefined) ??
    null
  );
}

/**
 * The new server takes over from the old one after a reinstall: it gets the
 * old addresses, connection mode and Wi-Fi rule. The old users cannot move
 * (the new server has new user Ids), so they go. The old entry stays only
 * while it still has downloads that did not move (`keepOld`).
 */
export function adoptServer(data: AccountsData, oldId: string, newId: string, keepOld: boolean): AccountsData {
  const old = findServer(data, oldId);
  const fresh = findServer(data, newId);
  if (!old || !fresh || old === fresh) return data;
  const addresses = fresh.addresses.slice();
  for (const a of old.addresses) if (!addresses.some((b) => sameUrl(a.url, b.url))) addresses.push({ ...a });
  let next = updateServer(data, fresh.id, { addresses, mode: old.mode, wifi: old.wifi });
  if (keepOld) {
    next = { ...next, servers: next.servers.map((s) => (s.id === old.id ? { ...s, users: [] } : s)) };
    if (next.active && sameServerId(next.active.serverId, old.id)) next = { ...next, active: null };
    return next;
  }
  return removeServer(next, old.id);
}
