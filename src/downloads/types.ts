/**
 * Download records. They are versioned from day one: `migrate.ts` turns any
 * older saved shape into the current one, so an app update never loses what
 * is on the device.
 */
import type { BaseItemDto } from '@/api/types';

export const DOWNLOAD_SCHEMA_VERSION = 2;

/**
 * queued → downloading → completed
 *            ↓  ↑
 *          paused        failed (retry with backoff) → queued
 * Any state that is not completed → cancelled (the record is then removed).
 */
export type DownloadState = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type MediaKind = 'video' | 'audio';

/** What the Downloaded list groups by: a show, an album, or a single item. */
export interface DownloadGroup {
  id: string;
  name: string;
  type: 'Series' | 'MusicAlbum' | 'Single';
}

export interface LocalSubtitle {
  index: number;
  label: string;
  language: string | null;
  isDefault: boolean;
  isForced: boolean;
  /** File name in the item folder (WebVTT). */
  file: string;
}

export interface LocalImages {
  /** File names in the item folder. */
  primary?: string;
  backdrop?: string;
}

/** One downloadable item: a movie, an episode, a song or an audiobook. */
export interface DownloadRecord {
  schemaVersion: typeof DOWNLOAD_SCHEMA_VERSION;
  itemId: string;
  serverId: string;
  userId: string;
  kind: MediaKind;
  /** The slim item, so lists, search and the players work with no server. */
  item: BaseItemDto;
  group: DownloadGroup;
  /** Sort order inside the group (season * 10000 + episode, disc * 1000 + track). */
  sort: number;
  state: DownloadState;
  bytesTotal: number | null;
  bytesDone: number;
  /** Bytes per second, measured while downloading. */
  speed: number;
  /** Epoch ms of the last progress event (for the speed). */
  progressAt: number | null;
  /** Failed attempts in a row; the next retry waits longer each time. */
  attempts: number;
  /** Epoch ms when a failed download may start again by itself. */
  retryAt: number | null;
  error: string | null;
  /** Folder of this item, relative to the app's document directory. */
  dir: string;
  /** File name of the media inside `dir`, once known. */
  mediaFile: string;
  mediaSourceId: string;
  /** ETag or Last-Modified of the media response: a resume sends it as If-Range. */
  validator?: string | null;
  /** Direct play keeps the original file; transcode is a server copy at the download quality. */
  method: 'original' | 'transcode';
  /** The download quality that was chosen (0 = original). */
  quality: number;
  images: LocalImages;
  subtitles: LocalSubtitle[];
  hasLyrics: boolean;
  /** Queue order: lower starts first. */
  order: number;
  createdAt: number;
  completedAt: number | null;
}

/** A container the user downloaded as a whole (album, playlist, season, show). */
export interface DownloadCollection {
  id: string;
  serverId: string;
  type: string;
  name: string;
  item: BaseItemDto;
  itemIds: string[];
  images: LocalImages;
  dir: string;
  createdAt: number;
}

export interface DownloadsSnapshot {
  schemaVersion: typeof DOWNLOAD_SCHEMA_VERSION;
  records: Record<string, DownloadRecord>;
  collections: Record<string, DownloadCollection>;
}

/** What a row or a button shows for one item or container. */
export type DownloadStatus =
  | { state: 'none' }
  | { state: 'queued' | 'downloading' | 'paused'; progress: number }
  /** `missing`: it was downloaded, but the file is gone; a retry downloads it again. */
  | { state: 'failed'; progress: number; missing?: boolean }
  | { state: 'completed' };

/** Download quality: 0 is the original file; other values are a maximum video height. */
export type DownloadQuality = 0 | 1080 | 720 | 480;
