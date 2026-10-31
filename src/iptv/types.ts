/**
 * IPTV data shapes. A provider belongs to one signed-in account (server Id +
 * user Id), like the query cache. Records hold no secrets: the Xtream user
 * name and password and every M3U or XMLTV URL go to the secure store
 * (`secrets.ts`). Saved shapes carry a schema version (see `migrate.ts`).
 */

export type ProviderKind = 'xtream' | 'm3u';

/** The saved provider record (MMKV). No credentials and no URLs that can hold a token. */
export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  name: string;
  /** Xtream: the panel address with no credentials (`http://host:port`). M3U: null. */
  server: string | null;
  /** The user agent for lists, guides and streams, or null for the app's default. */
  userAgent: string | null;
  /** M3U: an XMLTV guide URL is saved (or the playlist names one). Xtream: always true. */
  hasGuide: boolean;
  createdAt: number;
  updatedAt: number;
  /** When the channel list was last loaded, or null. */
  refreshedAt: number | null;
  channelCount: number;
}

/** The secret part of a provider (secure store). */
export interface ProviderSecrets {
  /** Xtream. */
  username?: string;
  password?: string;
  /** M3U. */
  playlistUrl?: string;
  /** M3U: the XMLTV guide the user typed. */
  guideUrl?: string;
  /** M3U: the guide the playlist names in its header (`url-tvg`), used when the user typed none. */
  playlistGuideUrl?: string;
}

/** What the add and edit form gives. */
export type ProviderInput =
  | { kind: 'xtream'; name: string; server: string; username: string; password: string; userAgent: string | null }
  | { kind: 'm3u'; name: string; playlistUrl: string; guideUrl: string | null; userAgent: string | null };

export const PROVIDERS_SCHEMA_VERSION = 1;

/** The providers of one account, saved under a key per account. */
export interface ProvidersSnapshot {
  schemaVersion: number;
  providers: Record<string, ProviderRecord>;
  /** Provider ids in the user's order. */
  order: string[];
}

/** One live channel. Empty fields are left out, so the cache file stays small. */
export interface Channel {
  /** Stable for the provider across refreshes (favourites and recents use it). */
  id: string;
  name: string;
  /** The provider's group (category). '' when it has none. */
  group: string;
  logo?: string;
  /** The channel number (`tvg-chno`, Xtream `num`). */
  number?: number;
  /** The guide id (`tvg-id`, Xtream `epg_channel_id`). */
  epgId?: string;
  /** M3U: the stream URL (it can hold a token; it lives only in the app's files). */
  url?: string;
  /** M3U: the user agent the entry asks for (`#EXTVLCOPT:http-user-agent`). */
  userAgent?: string;
  /** Xtream: the stream id. */
  streamId?: number;
  /** Days of catch-up the provider keeps (phase 4). */
  archiveDays?: number;
}

export const CHANNELS_SCHEMA_VERSION = 1;

/** The channel cache file of one provider. */
export interface ChannelsFile {
  schemaVersion: number;
  providerId: string;
  savedAt: number;
  channels: Channel[];
}

export const LISTS_SCHEMA_VERSION = 1;

/** Favourites and recently watched channels of one provider (MMKV). */
export interface ChannelLists {
  schemaVersion: number;
  /** Channel ids, newest first. */
  favourites: string[];
  /** Channel ids with the time they last played, newest first. */
  recents: { id: string; at: number }[];
}

/** A programme in the guide. Times in ms since the epoch. */
export interface Programme {
  start: number;
  stop: number;
  title: string;
  description?: string;
}

export const GUIDE_SCHEMA_VERSION = 1;

/**
 * A compact guide window: the programmes of each channel (by guide id) that
 * overlap `from`..`to`. Phase 1 keeps a few hours for now and next; the grid
 * guide (phase 2) keeps a longer window in the same shape.
 */
export interface GuideWindow {
  schemaVersion: number;
  from: number;
  to: number;
  channels: Record<string, Programme[]>;
}

export interface NowNext {
  now: Programme | null;
  next: Programme | null;
}

/** A stream to try. The session tries them in order and shows `unsupported` when none plays. */
export interface StreamChoice {
  url: string;
  isHls: boolean;
}

export interface LiveStream {
  candidates: StreamChoice[];
  /** The user agent to send, or null. */
  userAgent: string | null;
  /** Shown when every candidate fails (a format this device does not play). */
  unsupported: string | null;
}
