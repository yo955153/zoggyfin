/**
 * The thin wrapper over `@jellyfin/sdk`. Screens call these functions, never the
 * SDK directly, so field lists live in one place and every call here has been
 * checked against a Jellyfin 10.11 server.
 */
import type { Api } from '@jellyfin/sdk';
import { getArtistApi } from '@jellyfin/sdk/lib/utils/api/artist-api';
import { getAuthenticationApi } from '@jellyfin/sdk/lib/utils/api/authentication-api';
import { getFilterApi } from '@jellyfin/sdk/lib/utils/api/filter-api';
import { getGenreApi } from '@jellyfin/sdk/lib/utils/api/genre-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getPersonApi } from '@jellyfin/sdk/lib/utils/api/person-api';
import { getPlaylistApi } from '@jellyfin/sdk/lib/utils/api/playlist-api';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api';
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';
import { getUserDataApi } from '@jellyfin/sdk/lib/utils/api/user-data-api';
import { getUserViewApi } from '@jellyfin/sdk/lib/utils/api/user-view-api';
import axios, { isCancel } from 'axios';

import type { LibraryQuery } from './query-keys';
import { serverUrlCandidates } from './server-url';
import type {
  AuthenticationResult,
  BaseItemDto,
  BaseItemKind,
  ImageType,
  ItemFields,
  ItemFilter,
  ItemSortBy,
  PublicSystemInfo,
  QueryFiltersLegacy,
  QuickConnectResult,
  UserDto,
} from './types';

export interface Page {
  items: BaseItemDto[];
  total: number;
  startIndex: number;
}

/** Fields every tile needs. Image tags and blurhashes come by default. */
const TILE_FIELDS: ItemFields[] = ['PrimaryImageAspectRatio', 'ChildCount', 'Trickplay'];
const IMAGE_TYPES: ImageType[] = ['Primary', 'Thumb', 'Backdrop'];
const tile = {
  fields: TILE_FIELDS,
  enableImageTypes: IMAGE_TYPES,
  imageTypeLimit: 1,
  enableUserData: true,
};

function toPage(data: { Items?: BaseItemDto[] | null; TotalRecordCount?: number; StartIndex?: number }): Page {
  const items = data.Items ?? [];
  return { items, total: data.TotalRecordCount ?? items.length, startIndex: data.StartIndex ?? 0 };
}

// ---- Server and sign-in ---------------------------------------------------------

export interface FoundServer {
  url: string;
  info: PublicSystemInfo;
}

/**
 * Finds a Jellyfin server from what the user typed. Tries HTTPS first when no
 * scheme is given. Throws the last error when nothing answers.
 */
export async function findServer(input: string, signal?: AbortSignal): Promise<FoundServer> {
  const candidates = serverUrlCandidates(input);
  if (!candidates.length) throw new Error('Enter a server address, for example https://jellyfin.example.com');
  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      const res = await axios.get<PublicSystemInfo>(`${url}/System/Info/Public`, { timeout: 8000, signal });
      if (res.data?.Id && res.data.Version) return { url, info: res.data };
      lastError = new Error('This address does not look like a Jellyfin server.');
    } catch (e) {
      if (isCancel(e)) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error('Cannot reach the server.');
}

export async function authenticateByName(api: Api, username: string, password: string): Promise<AuthenticationResult> {
  const res = await getAuthenticationApi(api).authenticateUserByName({
    authenticateUserByName: { Username: username, Pw: password },
  });
  return res.data;
}

export async function isQuickConnectEnabled(api: Api): Promise<boolean> {
  try {
    return (await getAuthenticationApi(api).getQuickConnectEnabled()).data === true;
  } catch {
    return false;
  }
}

export async function initiateQuickConnect(api: Api): Promise<QuickConnectResult> {
  return (await getAuthenticationApi(api).initiateQuickConnect()).data;
}

export async function quickConnectState(api: Api, secret: string): Promise<QuickConnectResult> {
  return (await getAuthenticationApi(api).getQuickConnectState({ secret })).data;
}

export async function authenticateWithQuickConnect(api: Api, secret: string): Promise<AuthenticationResult> {
  return (await getAuthenticationApi(api).authenticateWithQuickConnect({ quickConnectDto: { Secret: secret } })).data;
}

export async function logout(api: Api): Promise<void> {
  await getSessionApi(api).reportSessionEnded();
}

export async function getCurrentUser(api: Api): Promise<UserDto> {
  return (await getUserApi(api).getCurrentUser()).data;
}

// ---- Home -------------------------------------------------------------------------

export async function getViews(api: Api, userId: string): Promise<BaseItemDto[]> {
  return (await getUserViewApi(api).getUserViews({ userId })).data.Items ?? [];
}

export async function getResume(api: Api, userId: string, media: 'Video' | 'Audio'): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getResumeItems({
    userId,
    mediaTypes: [media],
    limit: 20,
    enableTotalRecordCount: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

export async function getNextUp(api: Api, userId: string, seriesId?: string): Promise<BaseItemDto[]> {
  const res = await getShowApi(api).getNextUp({
    userId,
    seriesId,
    limit: 20,
    enableTotalRecordCount: false,
    enableResumable: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

export async function getLatest(api: Api, userId: string, parentId: string): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getLatestMedia({ userId, parentId, limit: 20, ...tile });
  return res.data;
}

// ---- Items ------------------------------------------------------------------------

export async function getItem(api: Api, userId: string, itemId: string): Promise<BaseItemDto> {
  // GET /Items/{id} has no `fields` parameter: it returns the full item.
  return (await getLibraryApi(api).getItem({ itemId, userId })).data;
}

/** One page of a library grid. */
export async function getLibraryPage(
  api: Api,
  userId: string,
  q: LibraryQuery,
  startIndex: number,
  limit: number,
): Promise<Page> {
  const filters: ItemFilter[] = [];
  if (q.played === 'played') filters.push('IsPlayed');
  if (q.played === 'unplayed') filters.push('IsUnplayed');
  if (q.favorites) filters.push('IsFavorite');

  const sortBy: ItemSortBy[] = q.sortBy === 'SortName' ? ['SortName'] : [q.sortBy, 'SortName'];
  const res = await getLibraryApi(api).getItems({
    userId,
    parentId: q.parentId,
    includeItemTypes: q.includeItemTypes as BaseItemKind[],
    recursive: true,
    sortBy,
    sortOrder: [q.sortOrder],
    filters: filters.length ? filters : undefined,
    genres: q.genres.length ? [...q.genres] : undefined,
    years: q.years.length ? [...q.years] : undefined,
    startIndex,
    limit,
    enableTotalRecordCount: true,
    ...tile,
  });
  return toPage(res.data);
}

export async function getFilters(
  api: Api,
  userId: string,
  parentId: string,
  includeItemTypes: readonly string[],
): Promise<QueryFiltersLegacy> {
  const res = await getFilterApi(api).getQueryFiltersLegacy({
    userId,
    parentId,
    includeItemTypes: includeItemTypes as BaseItemKind[],
  });
  return res.data;
}

export async function getSeasons(api: Api, userId: string, seriesId: string): Promise<BaseItemDto[]> {
  const res = await getShowApi(api).getSeasons({ seriesId, userId, ...tile });
  return res.data.Items ?? [];
}

export async function getEpisodes(api: Api, userId: string, seriesId: string, seasonId: string): Promise<BaseItemDto[]> {
  const res = await getShowApi(api).getEpisodes({
    seriesId,
    seasonId,
    userId,
    ...tile,
    fields: [...TILE_FIELDS, 'Overview'],
  });
  return res.data.Items ?? [];
}

export type ChildrenKind = 'tracks' | 'items' | 'playlist' | 'artistAlbums' | 'personItems' | 'artistSongs';

/** Children of a container: album tracks, collection items, playlist entries, an artist's albums, a person's titles. */
export async function getChildren(api: Api, userId: string, parentId: string, kind: ChildrenKind): Promise<BaseItemDto[]> {
  const lib = getLibraryApi(api);
  switch (kind) {
    case 'tracks': {
      const res = await lib.getItems({
        userId,
        parentId,
        sortBy: ['ParentIndexNumber', 'IndexNumber', 'SortName'],
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'playlist': {
      const res = await getPlaylistApi(api).getPlaylistItems({ playlistId: parentId, userId, ...tile });
      return res.data.Items ?? [];
    }
    case 'artistAlbums': {
      const res = await lib.getItems({
        userId,
        albumArtistIds: [parentId],
        includeItemTypes: ['MusicAlbum'],
        recursive: true,
        sortBy: ['ProductionYear', 'SortName'],
        sortOrder: ['Descending', 'Ascending'],
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'artistSongs': {
      const res = await lib.getItems({
        userId,
        artistIds: [parentId],
        includeItemTypes: ['Audio'],
        recursive: true,
        sortBy: ['PlayCount', 'SortName'],
        sortOrder: ['Descending', 'Ascending'],
        limit: 20,
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'personItems': {
      const res = await lib.getItems({
        userId,
        personIds: [parentId],
        includeItemTypes: ['Movie', 'Series'],
        recursive: true,
        sortBy: ['PremiereDate', 'SortName'],
        sortOrder: ['Descending', 'Ascending'],
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'items':
    default: {
      const res = await lib.getItems({ userId, parentId, sortBy: ['PremiereDate', 'SortName'], ...tile });
      return res.data.Items ?? [];
    }
  }
}

export async function getSimilar(api: Api, userId: string, itemId: string): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getSimilarItems({ itemId, userId, limit: 16, fields: TILE_FIELDS });
  return res.data.Items ?? [];
}

// ---- Music ------------------------------------------------------------------------

export type MusicTab = 'albums' | 'artists' | 'playlists' | 'songs' | 'genres';

export async function getMusicPage(
  api: Api,
  userId: string,
  libraryId: string,
  tab: MusicTab,
  startIndex: number,
  limit: number,
): Promise<Page> {
  const base = { userId, startIndex, limit, enableTotalRecordCount: true, ...tile };
  switch (tab) {
    case 'artists': {
      const res = await getArtistApi(api).getAlbumArtists({ ...base, parentId: libraryId, sortBy: ['SortName'] });
      return toPage(res.data);
    }
    case 'genres': {
      const res = await getGenreApi(api).getGenres({ ...base, parentId: libraryId, sortBy: ['SortName'] });
      return toPage(res.data);
    }
    case 'playlists': {
      // Playlists live outside music libraries. Only audio playlists belong here.
      const res = await getLibraryApi(api).getItems({
        ...base,
        includeItemTypes: ['Playlist'],
        recursive: true,
        sortBy: ['SortName'],
        mediaTypes: ['Audio'],
      });
      return toPage(res.data);
    }
    case 'songs': {
      const res = await getLibraryApi(api).getItems({
        ...base,
        parentId: libraryId,
        includeItemTypes: ['Audio'],
        recursive: true,
        sortBy: ['SortName'],
      });
      return toPage(res.data);
    }
    case 'albums':
    default: {
      const res = await getLibraryApi(api).getItems({
        ...base,
        parentId: libraryId,
        includeItemTypes: ['MusicAlbum'],
        recursive: true,
        sortBy: ['SortName'],
      });
      return toPage(res.data);
    }
  }
}

/** Songs and albums of one genre in a music library. */
export async function getGenreItems(api: Api, userId: string, libraryId: string | undefined, genreId: string): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems({
    userId,
    parentId: libraryId,
    genreIds: [genreId],
    includeItemTypes: ['MusicAlbum'],
    recursive: true,
    sortBy: ['SortName'],
    ...tile,
  });
  return res.data.Items ?? [];
}

// ---- User data -------------------------------------------------------------------

export async function setFavorite(api: Api, userId: string, itemId: string, favorite: boolean): Promise<void> {
  const ud = getUserDataApi(api);
  if (favorite) await ud.markFavoriteItem({ itemId, userId });
  else await ud.unmarkFavoriteItem({ itemId, userId });
}

export async function setPlayed(api: Api, userId: string, itemId: string, played: boolean): Promise<void> {
  const ud = getUserDataApi(api);
  if (played) await ud.markPlayedItem({ itemId, userId });
  else await ud.markUnplayedItem({ itemId, userId });
}

// ---- Search -----------------------------------------------------------------------

const SEARCH_TYPES: BaseItemKind[] = [
  'Movie',
  'Series',
  'Episode',
  'BoxSet',
  'MusicAlbum',
  'Audio',
  'Playlist',
  'Video',
  'MusicVideo',
];

/** Items, artists and people in parallel. Artists and people are not returned by /Items. */
export async function search(api: Api, userId: string, term: string, signal?: AbortSignal): Promise<BaseItemDto[]> {
  const opts = { signal };
  const [items, artists, people] = await Promise.all([
    getLibraryApi(api).getItems(
      { userId, searchTerm: term, recursive: true, includeItemTypes: SEARCH_TYPES, limit: 60, ...tile },
      opts,
    ),
    getArtistApi(api).getArtists({ userId, searchTerm: term, limit: 12, ...tile }, opts),
    getPersonApi(api).getPersons({ userId, searchTerm: term, limit: 12, enableImageTypes: ['Primary'] }, opts),
  ]);
  return [...(artists.data.Items ?? []), ...(items.data.Items ?? []), ...(people.data.Items ?? [])];
}
