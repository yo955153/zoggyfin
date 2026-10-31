/**
 * The films and series part of `@/iptv` (exported by `index.ts`): hooks and
 * the `vod` object. Screens never call a provider, the files or the store.
 */
import { useEffect, useMemo } from 'react';

import { usePlayer } from '@/player';

import { bindSession } from './manager';
import { useIptvStore } from './store';
import { EMPTY_VOD_LISTS, playOrder } from './vod-lists';
import {
  ALL_CATEGORY,
  episodeRequest,
  filmRequest,
  findTitle,
  forgetPosition,
  loadAll,
  loadCategories,
  loadCategory,
  loadInfo,
  refreshCatalogue,
  toggleFavouriteTitle,
  vodListsOf,
} from './vod-manager';
import { searchTitles } from './vod-search';
import {
  catalogueKey,
  categoryKey,
  EMPTY_ALL,
  EMPTY_CATEGORIES,
  EMPTY_INFO,
  EMPTY_LIST,
  infoKey,
  type Loaded,
  useVodStore,
  type VodInfo,
} from './vod-store';
import type { Episode, Film, FilmInfo, Season, Series, SeriesInfo, VodCategory, VodItem, VodKind, VodLists } from './vod-types';

export type { Episode, Film, FilmInfo, Season, Series, SeriesInfo, VodCategory, VodFavourite, VodItem, VodKind, VodLists, VodPosition } from './vod-types';
export type { Loaded } from './vod-store';
export { ALL_CATEGORY } from './vod-manager';
export {
  continueWatching,
  episodeCode,
  favouritesOf,
  isVodFavourite,
  playedFractionOf,
  playOrder,
  positionOf,
  resumeAt,
  seriesTarget,
} from './vod-lists';

export const vod = {
  /** Loads the films or series of a provider again (categories and the loaded lists). */
  refresh: refreshCatalogue,
  /** Adds or removes a favourite film or series. True when it is now a favourite. */
  toggleFavourite: toggleFavouriteTitle,
  /** Removes a title from Continue watching. */
  forget: forgetPosition,
  reloadInfo: (pid: string, kind: VodKind, id: string) => loadInfo(pid, kind, id, true),
};

/** The categories of films or series; loads them when they are not loaded. */
export function useVodCategories(providerId: string | null, kind: VodKind): Loaded<VodCategory[]> {
  bindSession();
  const data = useVodStore((s) => (providerId ? (s.categories[catalogueKey(providerId, kind)] ?? EMPTY_CATEGORIES) : EMPTY_CATEGORIES));
  useEffect(() => {
    if (providerId) void loadCategories(providerId, kind);
  }, [providerId, kind]);
  return data;
}

/** The titles of a category (`ALL_CATEGORY`: every title). */
export function useVodCategory(providerId: string | null, kind: VodKind, categoryId: string): Loaded<VodItem[]> {
  bindSession();
  const list = useVodStore((s) => (providerId && categoryId !== ALL_CATEGORY ? (s.lists[categoryKey(providerId, kind, categoryId)] ?? EMPTY_LIST) : EMPTY_LIST));
  const all = useVodStore((s) => (providerId && categoryId === ALL_CATEGORY ? (s.all[catalogueKey(providerId, kind)] ?? EMPTY_ALL) : EMPTY_ALL));
  useEffect(() => {
    if (providerId) void loadCategory(providerId, kind, categoryId);
  }, [providerId, kind, categoryId]);
  const allView = useMemo<Loaded<VodItem[]>>(() => ({ ...all, data: all.data.items }), [all]);
  return categoryId === ALL_CATEGORY ? allView : list;
}

/**
 * Titles that match a search, best first. The full catalogue loads for the
 * first search (a large one can take a while); `status` says when it is ready.
 */
export function useVodSearch(providerId: string | null, kind: VodKind, query: string): { status: Loaded<unknown>['status']; error: string | null; results: VodItem[] } {
  bindSession();
  const all = useVodStore((s) => (providerId ? (s.all[catalogueKey(providerId, kind)] ?? EMPTY_ALL) : EMPTY_ALL));
  const active = !!query.trim();
  useEffect(() => {
    if (providerId && active) void loadAll(providerId, kind);
  }, [providerId, kind, active]);
  const results = useMemo(() => (active && all.data.index ? searchTitles(all.data.index, query) : []), [active, all.data.index, query]);
  return { status: all.status, error: all.error, results };
}

/** The details of a film or a series; loads them when they are not loaded. */
export function useVodInfo(providerId: string | null, kind: 'film', id: string): Loaded<FilmInfo | null>;
export function useVodInfo(providerId: string | null, kind: 'series', id: string): Loaded<SeriesInfo | null>;
export function useVodInfo(providerId: string | null, kind: VodKind, id: string): Loaded<VodInfo | null> {
  bindSession();
  const info = useVodStore((s) => (providerId ? (s.info[infoKey(providerId, kind, id)] ?? EMPTY_INFO) : EMPTY_INFO));
  useEffect(() => {
    if (providerId && id) void loadInfo(providerId, kind, id);
  }, [providerId, kind, id]);
  return info;
}

/** A title from the loaded catalogues (a page opened from a tile has it at once), or null. */
export function useVodTitle(providerId: string | null, kind: 'film', id: string): Film | null;
export function useVodTitle(providerId: string | null, kind: 'series', id: string): Series | null;
export function useVodTitle(providerId: string | null, kind: VodKind, id: string): VodItem | null {
  // Any catalogue change can bring the title: read it again when one does.
  const all = useVodStore((s) => (providerId ? s.all[catalogueKey(providerId, kind)] : undefined));
  const lists = useVodStore((s) => s.lists);
  const m3u = useVodStore((s) => (providerId ? s.m3u[providerId] : undefined));
  return useMemo(
    () => (providerId && id ? findTitle(providerId, kind, id) : null),
    // The store parts above are what findTitle reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerId, kind, id, all, lists, m3u],
  );
}

/** The favourites and positions of a provider. */
export function useVodLists(providerId: string | null): VodLists {
  bindSession();
  const lists = useVodStore((s) => (providerId ? s.vodLists[providerId] : undefined));
  useEffect(() => {
    if (providerId && !lists) vodListsOf(providerId);
  }, [providerId, lists]);
  return lists ?? EMPTY_VOD_LISTS;
}

/**
 * Which libraries a provider has: Xtream always offers both (a panel with
 * none shows empty pages); an M3U list only when it holds film or episode entries.
 */
export function useVodKinds(providerId: string | null): { film: boolean; series: boolean } {
  const kind = useIptvStore((s) => (providerId ? s.providers.providers[providerId]?.kind : undefined));
  const m3u = useVodStore((s) => (providerId ? s.m3u[providerId] : undefined));
  if (kind === 'xtream') return { film: true, series: true };
  return { film: !!m3u?.films.length, series: !!m3u?.series.length };
}

/** Plays films and episodes in the player (seekable, positions kept on this device). */
export function useVodPlayer(): {
  playFilm: (providerId: string, film: Film, info: FilmInfo | null, startSeconds: number) => void;
  playEpisode: (providerId: string, series: Pick<Series, 'id' | 'name' | 'poster'>, seasons: readonly Season[], episode: Episode, startSeconds: number) => void;
} {
  const player = usePlayer();
  return {
    playFilm: (pid, film, info, start) => player.playVod(filmRequest(pid, film, info, start)),
    playEpisode: (pid, series, seasons, episode, start) => player.playVod(episodeRequest(pid, series, playOrder(seasons), episode, start)),
  };
}
