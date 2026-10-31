/**
 * "All providers" in Live TV, and the rules for a list of several providers.
 *
 * The merged view shows Favourites, Recently watched and Search of every
 * provider together. A channel in it is a `ProviderChannel`: the provider id,
 * the channel, and a key that is unique across providers
 * (`<providerId>|<channelId>`; provider ids are UUIDs with no "|").
 *
 * Memory: Favourites and Recently watched need no channel list. A provider
 * whose list is loaded gives its fresh channel; any other provider gives the
 * snap the lists keep (`ChannelLists.snaps`). A favourite with neither (a v1
 * list whose provider has not loaded since the upgrade) is left out until
 * that list loads; the screen loads such a provider's list once. Only Search
 * loads every provider's list.
 *
 * Pure, so it is unit-tested.
 */
import { MAX_RECENTS } from './lists';
import type { RankedHit } from './search';
import type { Channel, ChannelLists } from './types';

/** The `activeId` of the merged view ("All providers"). Not a provider id. */
export const ALL_PROVIDERS = '*all';

export interface ProviderChannel {
  /** Unique across providers: list keys, the player's channel ids. */
  key: string;
  providerId: string;
  channel: Channel;
}

export const providerChannelKey = (providerId: string, channelId: string): string => `${providerId}|${channelId}`;

/** The provider and channel of a merged key, or null for a key that is not one. */
export function splitProviderChannelKey(key: string): { providerId: string; channelId: string } | null {
  const i = key.indexOf('|');
  if (i <= 0 || i === key.length - 1) return null;
  return { providerId: key.slice(0, i), channelId: key.slice(i + 1) };
}

export function asProviderChannel(providerId: string, channel: Channel): ProviderChannel {
  return { key: providerChannelKey(providerId, channel.id), providerId, channel };
}

/**
 * The loaded channel of a provider. `undefined`: the provider's list is not
 * in memory (use the snap). `null`: the list is loaded and the channel is
 * no longer in it (leave it out, like the provider's own Favourites do).
 */
export type ChannelLookup = (providerId: string, channelId: string) => Channel | null | undefined;

function channelOf(providerId: string, id: string, lists: ChannelLists, lookup: ChannelLookup): Channel | null {
  const live = lookup(providerId, id);
  if (live !== undefined) return live;
  const s = lists.snaps[id];
  return s ? { ...s } : null;
}

/** The favourites of every provider: in the providers' order, each provider's newest first. */
export function mergedFavourites(providerIds: readonly string[], listsOf: (providerId: string) => ChannelLists, lookup: ChannelLookup): ProviderChannel[] {
  const out: ProviderChannel[] = [];
  for (const pid of providerIds) {
    const lists = listsOf(pid);
    for (const id of lists.favourites) {
      const c = channelOf(pid, id, lists, lookup);
      if (c) out.push(asProviderChannel(pid, c));
    }
  }
  return out;
}

/** Recently watched across providers, newest first, at most `limit`. */
export function mergedRecents(
  providerIds: readonly string[],
  listsOf: (providerId: string) => ChannelLists,
  lookup: ChannelLookup,
  limit: number = MAX_RECENTS,
): ProviderChannel[] {
  const all: { at: number; order: number; item: ProviderChannel }[] = [];
  for (const pid of providerIds) {
    const lists = listsOf(pid);
    for (const r of lists.recents) {
      const c = channelOf(pid, r.id, lists, lookup);
      if (c) all.push({ at: r.at, order: all.length, item: asProviderChannel(pid, c) });
    }
  }
  all.sort((a, b) => b.at - a.at || a.order - b.order);
  return all.slice(0, limit).map((x) => x.item);
}

/**
 * Search hits of several providers as one list: the best match step first
 * (an exact channel number before a name match), then the providers' order,
 * then each provider's own order.
 */
export function mergeSearchHits(perProvider: readonly { providerId: string; hits: readonly RankedHit[] }[], limit: number): ProviderChannel[] {
  const all: { step: number; p: number; i: number; item: ProviderChannel }[] = [];
  perProvider.forEach(({ providerId, hits }, p) => {
    hits.forEach((h, i) => all.push({ step: h.step, p, i, item: asProviderChannel(providerId, h.channel) }));
  });
  all.sort((a, b) => a.step - b.step || a.p - b.p || a.i - b.i);
  return all.slice(0, limit).map((x) => x.item);
}

/**
 * A provider name no other provider has, so the chips and labels tell them
 * apart: "Playlist", then "Playlist 2", "Playlist 3". Case does not count.
 */
export function uniqueProviderName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  const base = name.trim();
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const next = `${base} ${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** Moves an id one place up (-1) or down (+1). The same array when it cannot move. */
export function moveInOrder(order: readonly string[], id: string, delta: -1 | 1): readonly string[] {
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * What Live TV shows: the chosen start ("All providers" or a provider), else
 * the last one used, else the first provider. "All providers" needs two
 * providers or more.
 */
export function resolveActive(startWith: string | null | undefined, lastUsed: string | null, order: readonly string[]): string | null {
  if (!order.length) return null;
  const ok = (id: string | null | undefined): id is string => !!id && (id === ALL_PROVIDERS ? order.length > 1 : order.includes(id));
  if (ok(startWith)) return startWith;
  if (ok(lastUsed)) return lastUsed;
  return order[0];
}

/**
 * Providers with a favourite or recent that has no snap yet (lists saved
 * before snaps existed). Their channel lists load once, which fills the snaps.
 */
export function providersMissingSnaps(providerIds: readonly string[], listsOf: (providerId: string) => ChannelLists): string[] {
  return providerIds.filter((pid) => {
    const l = listsOf(pid);
    return l.favourites.some((id) => !l.snaps[id]) || l.recents.some((r) => !l.snaps[r.id]);
  });
}
