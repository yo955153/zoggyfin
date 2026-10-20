/**
 * The media of a nearby session: which files the host shares on its session
 * port, and where a guest reads each item (its own download, the host's
 * file, or nothing).
 *
 * Every URL path has a random token of the session, so only a guest that got
 * the path from the host can read a file. The port stops with the session.
 */
import { type DownloadRecord, findDownload, localExtraUri, localFileFor } from '@/downloads';

import { matchesShared } from './match';
import type { SharedItem } from './protocol';

/** A completed download whose file is on this device (any saved server). With a server id, it must match. */
export function localRecord(itemId: string | null | undefined, serverId?: string | null): DownloadRecord | null {
  const r = findDownload(itemId);
  if (!r || !itemId || !matchesShared(r, { id: itemId, serverId })) return null;
  return localFileFor(r.itemId) ? r : null;
}

export function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'mov':
      return 'video/quicktime';
    case 'm4v':
      return 'video/x-m4v';
    case 'mkv':
      return 'video/x-matroska';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
    case 'm4b':
    case 'aac':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'video/mp4';
  }
}

/** The disk path of a file URI. */
export function pathOf(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function ext(file: string, fallback: string): string {
  const e = file.split('.').pop();
  return e && e.length <= 5 && e !== file ? e : fallback;
}

export interface ShareSink {
  shareFile(urlPath: string, filePath: string, mimeType: string): void;
}

/**
 * The files that the host shares, by item id. Each item gets one path for
 * the media and one for the cover (when downloaded), however often it is in
 * the queue.
 */
export class HostShares {
  private media = new Map<string, string | null>();
  private art = new Map<string, string | null>();
  private n = 0;

  constructor(
    private readonly sink: ShareSink,
    readonly token: string,
  ) {}

  /** The URL path of the item's file, or null when this device has no file for it. */
  mediaPath(itemId: string, serverId?: string | null): string | null {
    if (this.media.has(itemId)) return this.media.get(itemId) ?? null;
    const r = localRecord(itemId, serverId);
    const uri = r ? localFileFor(r.itemId) : null;
    let path: string | null = null;
    if (r && uri) {
      this.n += 1;
      const e = ext(r.mediaFile, 'mp4');
      path = `/${this.token}/${this.n}.${e}`;
      this.sink.shareFile(path, pathOf(uri), mimeFor(e));
    }
    this.media.set(itemId, path);
    return path;
  }

  /** The URL path of the item's downloaded cover, or null. */
  artPath(itemId: string): string | null {
    if (this.art.has(itemId)) return this.art.get(itemId) ?? null;
    const r = findDownload(itemId);
    const file = r?.state === 'completed' && r.images.primary ? localExtraUri(r, r.images.primary) : null;
    let path: string | null = null;
    if (file && r?.images.primary) {
      this.n += 1;
      const e = ext(r.images.primary, 'jpg');
      path = `/${this.token}/a${this.n}.${e}`;
      this.sink.shareFile(path, pathOf(file), mimeFor(e));
    }
    this.art.set(itemId, path);
    return path;
  }
}

/** Where a guest reads an item: its own download, else the host's file, else null. */
export function guestSource(item: SharedItem, base: string | null, opts: { forceStream?: boolean } = {}): { uri: string; local: boolean } | null {
  const r = opts.forceStream ? null : localRecord(item.id, item.serverId);
  const own = r ? localFileFor(r.itemId) : null;
  if (own) return { uri: own, local: true };
  if (base && item.path) return { uri: `${base}${item.path}`, local: false };
  return null;
}
