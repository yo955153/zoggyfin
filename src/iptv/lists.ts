/**
 * Channel groups and the per-provider lists (favourites, recently watched).
 * The group list starts with Favourites and Recently watched, then the
 * provider's groups in the order they first appear. Pure, so it is
 * unit-tested; `store.ts` saves the lists.
 */
import { type Channel, type ChannelLists, LISTS_SCHEMA_VERSION } from './types';

export const FAVOURITES_GROUP = 'fav';
export const RECENTS_GROUP = 'recent';
export const ALL_GROUP = 'all';
/** The group id of a provider group (its name); '' (no group) shows as "Other". */
export const groupKey = (name: string) => `g:${name}`;

export const MAX_RECENTS = 30;
export const MAX_FAVOURITES = 2000;

export const EMPTY_LISTS: ChannelLists = { schemaVersion: LISTS_SCHEMA_VERSION, favourites: [], recents: [] };

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

/** Adds or removes a favourite (new favourites go first). */
export function toggleFavourite(lists: ChannelLists, id: string): ChannelLists {
  const has = lists.favourites.includes(id);
  const favourites = has ? lists.favourites.filter((x) => x !== id) : [id, ...lists.favourites].slice(0, MAX_FAVOURITES);
  return { ...lists, favourites };
}

/** Puts a channel first in Recently watched. */
export function addRecent(lists: ChannelLists, id: string, at: number): ChannelLists {
  const recents = [{ id, at }, ...lists.recents.filter((r) => r.id !== id)].slice(0, MAX_RECENTS);
  return { ...lists, recents };
}
