/**
 * Query hooks. Each one pairs a key from `queryKeys` with a function from
 * `jellyfin.ts`. Screens use these and nothing lower.
 */
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import * as jf from './jellyfin';
import { type LibraryQuery, queryKeys } from './query-keys';
import { useApi } from './use-api';

const PAGE_SIZE = 60;

export function useViews() {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.views(scope), queryFn: () => jf.getViews(api, userId), staleTime: 5 * 60 * 1000 });
}

export function useResume(media: 'Video' | 'Audio') {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.resume(scope, media), queryFn: () => jf.getResume(api, userId, media) });
}

export function useNextUp(seriesId?: string) {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.nextUp(scope, seriesId), queryFn: () => jf.getNextUp(api, userId, seriesId) });
}

export function useLatest(parentId: string) {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.latest(scope, parentId), queryFn: () => jf.getLatest(api, userId, parentId) });
}

export function useItem(itemId: string | undefined) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.item(scope, itemId ?? ''),
    queryFn: () => jf.getItem(api, userId, itemId ?? ''),
    enabled: !!itemId,
  });
}

export function useLibrary(q: LibraryQuery) {
  const { api, userId, scope } = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.library(scope, q),
    queryFn: ({ pageParam }) => jf.getLibraryPage(api, userId, q, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.startIndex + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

export function useFilters(parentId: string, includeItemTypes: readonly string[]) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.filters(scope, parentId),
    queryFn: () => jf.getFilters(api, userId, parentId, includeItemTypes),
    staleTime: 30 * 60 * 1000,
  });
}

export function useSeasons(seriesId: string | undefined) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.seasons(scope, seriesId ?? ''),
    queryFn: () => jf.getSeasons(api, userId, seriesId ?? ''),
    enabled: !!seriesId,
  });
}

export function useEpisodes(seriesId: string | undefined, seasonId: string | undefined) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.episodes(scope, seriesId ?? '', seasonId ?? ''),
    queryFn: () => jf.getEpisodes(api, userId, seriesId ?? '', seasonId ?? ''),
    enabled: !!seriesId && !!seasonId,
  });
}

export function useChildren(parentId: string | undefined, kind: jf.ChildrenKind, enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.children(scope, parentId ?? '', kind),
    queryFn: () => jf.getChildren(api, userId, parentId ?? '', kind),
    enabled: enabled && !!parentId,
  });
}

export function useSimilar(itemId: string | undefined, enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.similar(scope, itemId ?? ''),
    queryFn: () => jf.getSimilar(api, userId, itemId ?? ''),
    enabled: enabled && !!itemId,
  });
}

export function useMusicTab(libraryId: string | undefined, tab: jf.MusicTab, options: jf.MusicOptions = jf.DEFAULT_MUSIC_OPTIONS, enabled = true) {
  const { api, userId, scope } = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.music(scope, libraryId ?? '', tab, options),
    queryFn: ({ pageParam }) => jf.getMusicPage(api, userId, libraryId ?? '', tab, pageParam, PAGE_SIZE, options),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.startIndex + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
    enabled: enabled && !!libraryId,
  });
}

export function usePlayedSongs(libraryId: string | undefined, kind: 'recent' | 'most') {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.played(scope, libraryId ?? '', kind),
    queryFn: () => jf.getPlayedSongs(api, userId, libraryId ?? '', kind),
    enabled: !!libraryId,
  });
}

export function useGenreItems(libraryId: string | undefined, genreId: string | undefined) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.children(scope, `${libraryId ?? ''}:${genreId ?? ''}`, 'genre'),
    queryFn: () => jf.getGenreItems(api, userId, libraryId || undefined, genreId ?? ''),
    enabled: !!genreId,
  });
}

export function useSearch(term: string) {
  const { api, userId, scope } = useApi();
  const t = term.trim();
  return useQuery({
    queryKey: queryKeys.search(scope, t),
    queryFn: ({ signal }) => jf.search(api, userId, t, signal),
    enabled: t.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
}
