/**
 * Channel groups and the per-provider lists (favourites, recently watched).
 * The group list starts with Favourites and Recently watched, then the
 * provider's groups in the order they first appear. Pure, so it is
 * unit-tested; `store.ts` saves the lists.
 */
import { type Channel, type ChannelLists, type ChannelSnap, LISTS_SCHEMA_VERSION } from './types';

export const FAVOURITES_GROUP = 'fav';
export const RECENTS_GROUP = 'recent';
export const ALL_GROUP = 'all';
/** The group id of a provider group (its name); '' (no group) shows as "Other". */
export const groupKey = (name: string) => `g:${name}`;

export const MAX_RECENTS = 30;
export const MAX_FAVOURITES = 2000;

export const EMPTY_LISTS: ChannelLists = { schemaVersion: LISTS_SCHEMA_VERSION, favourites: [], recents: [], snaps: {} };

/** The part of a channel the lists keep (no stream URL, no user agent). */
export function snapOf(c: Channel): ChannelSnap {
  const s: ChannelSnap = { id: c.id, name: c.name, group: c.group };
  if (c.logo) s.logo = c.logo;
  if (c.number !== undefined) s.number = c.number;
  if (c.epgId) s.epgId = c.epgId;
  if (c.streamId !== undefined) s.streamId = c.streamId;
  return s;
}

const sameSnap = (a: ChannelSnap | undefined, b: ChannelSnap) =>
  !!a && a.name === b.name && a.group === b.group && a.logo === b.logo && a.number === b.number && a.epgId === b.epgId && a.streamId === b.streamId;

/** Keeps only the snaps of channels in the favourites or recents. */
function pruneSnaps(lists: ChannelLists, snaps: Record<string, ChannelSnap>): Record<string, ChannelSnap> {
  const keep: Record<string, ChannelSnap> = {};
  for (const id of lists.favourites) if (snaps[id]) keep[id] = snaps[id];
  for (const r of lists.recents) if (snaps[r.id]) keep[r.id] = snaps[r.id];
  return keep;
}

/**
 * Fills and refreshes the snaps of the favourites and recents from a loaded
 * channel list (a renamed channel or a new logo shows in "All providers"),
 * and drops the snaps of channels no longer listed. Returns the same object
 * when nothing changes, so a caller saves only real changes.
 */
export function withSnaps(lists: ChannelLists, channels: readonly Channel[]): ChannelLists {
  const wanted = new Set([...lists.favourites, ...lists.recents.map((r) => r.id)]);
  let changed = Object.keys(lists.snaps).some((id) => !wanted.has(id));
  const snaps: Record<string, ChannelSnap> = { ...lists.snaps };
  if (wanted.size) {
    for (const c of channels) {
      if (!wanted.has(c.id)) continue;
      const s = snapOf(c);
      if (!sameSnap(snaps[c.id], s)) {
        snaps[c.id] = s;
        changed = true;
      }
    }
  }
  return changed ? { ...lists, snaps: pruneSnaps(lists, snaps) } : lists;
}

export interface GroupView {
  key: string;
  label: string;
  count: number;
}

/** The groups to show. Favourites and Recently watched always come first (they can be empty). */
export function buildGroups(channels: readonly Channel[], lists: ChannelLists): GroupView[] {
  const ids = new Set(channels.map((c) => c.id));
  const counts = new Map<string, number>();
  for (const c of channels) counts.set(c.group, (counts.get(c.group) ?? 0) + 1);
  const groups: GroupView[] = [
    { key: FAVOURITES_GROUP, label: 'Favourites', count: lists.favourites.filter((id) => ids.has(id)).length },
    { key: RECENTS_GROUP, label: 'Recently watched', count: lists.recents.filter((r) => ids.has(r.id)).length },
    { key: ALL_GROUP, label: 'All channels', count: channels.length },
  ];
  for (const [name, count] of counts) groups.push({ key: groupKey(name), label: name || 'Other', count });
  return groups;
}

/** The channels of a group, in its order (favourites and recents newest first). */
export function channelsInGroup(channels: readonly Channel[], lists: ChannelLists, key: string): Channel[] {
  if (key === ALL_GROUP) return channels.slice();
  if (key === FAVOURITES_GROUP || key === RECENTS_GROUP) {
    const byId = new Map(channels.map((c) => [c.id, c]));
    const ids = key === FAVOURITES_GROUP ? lists.favourites : lists.recents.map((r) => r.id);
    return ids.map((id) => byId.get(id)).filter((c): c is Channel => !!c);
  }
  const name = key.startsWith('g:') ? key.slice(2) : key;
  return channels.filter((c) => c.group === name);
}

export function isFavourite(lists: ChannelLists, id: string): boolean {
  return lists.favourites.includes(id);
}

/** Adds or removes a favourite (new favourites go first). `snap`: the channel, kept for "All providers". */
export function toggleFavourite(lists: ChannelLists, id: string, snap?: ChannelSnap): ChannelLists {
  const has = lists.favourites.includes(id);
  const favourites = has ? lists.favourites.filter((x) => x !== id) : [id, ...lists.favourites].slice(0, MAX_FAVOURITES);
  const next = { ...lists, favourites };
  return { ...next, snaps: pruneSnaps(next, snap && !has ? { ...lists.snaps, [id]: snap } : lists.snaps) };
}

/** Puts a channel first in Recently watched. `snap`: the channel, kept for "All providers". */
export function addRecent(lists: ChannelLists, id: string, at: number, snap?: ChannelSnap): ChannelLists {
  const recents = [{ id, at }, ...lists.recents.filter((r) => r.id !== id)].slice(0, MAX_RECENTS);
  const next = { ...lists, recents };
  return { ...next, snaps: pruneSnaps(next, snap ? { ...lists.snaps, [id]: snap } : lists.snaps) };
}
