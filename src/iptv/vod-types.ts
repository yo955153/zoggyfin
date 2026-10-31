/**
 * IPTV films and series (phase 3). Xtream providers give a catalogue per
 * category (`get_vod_streams`, `get_series`) and the details of one title
 * (`get_vod_info`, `get_series_info`). M3U lists can hold film and episode
 * entries too (`m3u-vod.ts`). Empty fields are left out, so the cache files
 * stay small. Saved shapes carry a schema version (see `vod-migrate.ts`).
 */

export type VodKind = 'film' | 'series';

export interface VodCategory {
  id: string;
  name: string;
}

/** One film of the catalogue. */
export interface Film {
  /** Stable for the provider across refreshes (favourites and positions use it). */
  id: string;
  name: string;
  categoryId: string;
  poster?: string;
  year?: number;
  /** 0 to 10. */
  rating?: number;
  /** When the provider added it, ms since the epoch. */
  added?: number;
  /** The file type (`container_extension`): mp4, mkv, m3u8… lower case. */
  ext?: string;
  /** Xtream: the stream id. */
  streamId?: number;
  /** M3U: the stream URL (it can hold a token; it lives only in the app's files). */
  url?: string;
  tmdb?: string;
}

/** One series of the catalogue. */
export interface Series {
  id: string;
  name: string;
  categoryId: string;
  poster?: string;
  year?: number;
  rating?: number;
  added?: number;
  plot?: string;
  genre?: string;
  cast?: string;
  /** Xtream: the series id for `get_series_info`. */
  seriesId?: number;
  tmdb?: string;
  /** M3U: the episodes come with the list (Xtream loads them with the details). */
  episodes?: Episode[];
}

export type VodItem = Film | Series;

/** The details of a film (`get_vod_info`). */
export interface FilmInfo {
  /** The title from the details (used when the catalogue entry is not loaded). */
  name?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  /** Seconds. */
  duration?: number;
  backdrop?: string;
  poster?: string;
  year?: number;
  rating?: number;
  ext?: string;
  releaseDate?: string;
}

export interface Episode {
  /** The provider's episode id (Xtream: the stream id of the episode). */
  id: string;
  season: number;
  /** The episode number in its season. */
  number: number;
  title: string;
  ext?: string;
  plot?: string;
  /** Seconds. */
  duration?: number;
  still?: string;
  /** M3U: the stream URL. */
  url?: string;
}

export interface Season {
  number: number;
  name: string;
  poster?: string;
  episodes: Episode[];
}

/** The details of a series (`get_series_info`): seasons in order, episodes in order. */
export interface SeriesInfo {
  name?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  backdrop?: string;
  poster?: string;
  year?: number;
  rating?: number;
  seasons: Season[];
}

export const VOD_CACHE_SCHEMA_VERSION = 1;

/** A cached catalogue file: the categories of a kind, or the titles of one category (or of all). */
export interface VodCacheFile<T> {
  schemaVersion: number;
  providerId: string;
  savedAt: number;
  data: T;
}

export const VOD_LISTS_SCHEMA_VERSION = 1;

/** A favourite film or series, with enough to show it before the catalogue loads. */
export interface VodFavourite {
  kind: VodKind;
  id: string;
  name: string;
  poster?: string;
  at: number;
}

/** Where a film or an episode stopped, on this device. Never sent to Jellyfin. */
export interface VodPosition {
  kind: 'film' | 'episode';
  /** The film id, or the episode id. */
  id: string;
  /** Episodes: the series id. */
  seriesId?: string;
  /** Seconds. */
  position: number;
  /** Seconds, 0 when not known. */
  duration: number;
  /** When it was saved, ms. */
  at: number;
  /** Played to the end (the position starts over next time). */
  finished: boolean;
  title: string;
  poster?: string;
  seriesName?: string;
  season?: number;
  episode?: number;
  ext?: string;
}

/** The favourites and positions of one provider (MMKV). */
export interface VodLists {
  schemaVersion: number;
  /** Newest first. */
  favourites: VodFavourite[];
  /** Keyed by `positionKey`. */
  positions: Record<string, VodPosition>;
}
