/**
 * The app-level IPTV interface (Live TV). Screens use these hooks and the
 * `iptv` object and never call a provider, the files or the secure store.
 * Providers belong to the signed-in account (server Id + user Id).
 */
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { usePlayer } from '@/player';

import { buildGroups, channelsInGroup, EMPTY_LISTS, type GroupView } from './lists';
import {
  bindSession,
  clearSearches,
  ensureLoaded,
  formValues,
  loadGuide,
  markWatched,
  nowNextOf,
  playRequest,
  providerById,
  recentSearchesOf,
  refresh,
  rememberSearchFor,
  removeProvider,
  requestNowNext,
  saveProvider,
  setActiveProvider,
  streamPlatform,
  toggleFavourite,
} from './manager';
import { searchChannels } from './search';
import { EMPTY_DATA, type ProviderData, useIptvStore } from './store';
import { needsHls } from './stream-url';
import { transport } from './transport';
import type { Channel, ChannelLists, NowNext, ProviderRecord } from './types';

export type { Channel, NowNext, ProviderInput, ProviderKind, ProviderRecord, Programme } from './types';
export type { GroupView } from './lists';
export type { ProviderData, LoadStatus } from './store';
export { ALL_GROUP, FAVOURITES_GROUP, RECENTS_GROUP } from './lists';
export { browseEntries, type BrowseEntry, type BrowseSection, defaultGroup, PROVIDERS_ENTRY, resolveGroup, SEARCH_ENTRY } from './browse';
export { iptvErrorText } from './errors';
export { progressOf } from './guide';

/** True when this platform sends the provider's user agent (the apps); a browser cannot. */
export const sendsUserAgent: boolean = transport.sendsUserAgent;
/** True where plain `.ts` channels need their HLS form (iPhone, iPad, Apple TV, browsers). */
export const prefersHls: boolean = needsHls(streamPlatform);

export const iptv = {
  save: saveProvider,
  remove: removeProvider,
  refresh,
  formValues,
  setActive: setActiveProvider,
  toggleFavourite,
  markWatched,
  reloadGuide: (id: string) => loadGuide(id, true),
  /** Xtream: asks for now and next of the channels on screen. */
  requestNowNext: (providerId: string, channels: readonly Channel[]) => requestNowNext(providerId, channels),
  provider: providerById,
  /** Keeps a search the person used (they played one of its channels). */
  rememberSearch: rememberSearchFor,
  clearSearches,
};

/** The recent channel searches of a provider, newest first. */
export function useRecentSearches(providerId: string | null): string[] {
  const kept = useIptvStore((s) => (providerId ? s.searches[providerId] : undefined));
  return useMemo(() => (providerId ? (kept ?? recentSearchesOf(providerId)).queries : []), [providerId, kept]);
}

/** The providers of the signed-in account, in order. */
export function useProviders(): ProviderRecord[] {
  bindSession();
  return useIptvStore(useShallow((s) => s.providers.order.map((id) => s.providers.providers[id]).filter((p): p is ProviderRecord => !!p)));
}

/** The provider the Live TV page shows (the last one picked, else the first). */
export function useActiveProviderId(): string | null {
  bindSession();
  return useIptvStore((s) => (s.activeId && s.providers.providers[s.activeId] ? s.activeId : (s.providers.order[0] ?? null)));
}

/** The channel list of a provider; loads it (from the file, else the provider) when it is not loaded. */
export function useChannels(providerId: string | null): ProviderData {
  bindSession();
  const data = useIptvStore((s) => (providerId ? (s.data[providerId] ?? EMPTY_DATA) : EMPTY_DATA));
  useEffect(() => {
    if (providerId) void ensureLoaded(providerId);
  }, [providerId]);
  return data;
}

export function useChannelLists(providerId: string | null): ChannelLists {
  return useIptvStore((s) => (providerId ? (s.lists[providerId] ?? EMPTY_LISTS) : EMPTY_LISTS));
}

/** The groups (Favourites and Recently watched first) and the channels of the picked group, or the search hits. */
export function useChannelView(providerId: string | null, group: string, query: string): { groups: GroupView[]; channels: Channel[] } {
  const data = useChannels(providerId);
  const lists = useChannelLists(providerId);
  const groups = useMemo(() => buildGroups(data.channels, lists), [data.channels, lists]);
  const channels = useMemo(() => {
    if (query.trim() && data.index) return searchChannels(data.index, query, 300);
    return channelsInGroup(data.channels, lists, group);
  }, [data.channels, data.index, lists, group, query]);
  return { groups, channels };
}

/** The time now, to the minute (now and next move on by themselves). */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Now and next of a channel (re-renders when the guide changes). */
export function useNowNext(providerId: string | null, channel: Channel | null, at: number): NowNext {
  const guide = useIptvStore((s) => (providerId ? s.guides[providerId] : undefined));
  const names = useIptvStore((s) => (providerId ? s.guideNames[providerId] : undefined));
  return useMemo(
    () => (providerId && channel && guide ? nowNextOf(providerId, channel, at) : { now: null, next: null }),
    // The guide and names objects change when the guide loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerId, channel, at, guide, names],
  );
}

/** Plays a channel; channel up and down move through `list`. */
export function usePlayChannel(): (providerId: string, list: readonly Channel[], channel: Channel) => void {
  const player = usePlayer();
  return (providerId, list, channel) => player.playLive(playRequest(providerId, list, channel));
}
