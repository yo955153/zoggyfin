/**
 * Migrations for saved download records. Every saved snapshot goes through
 * `migrateSnapshot` when the app starts; it never throws, and a record it
 * cannot read is dropped (its files are found again as orphans and removed).
 *
 * v1 (phase 1 stub): { schemaVersion: 1, itemId, serverId, title, state:
 *   'queued'|'downloading'|'paused'|'failed'|'done', bytesTotal, bytesDone,
 *   localPath, createdAt } in a flat list.
 * v2: see types.ts. Records keyed by item id, plus collections.
 */
import type { BaseItemDto } from '@/api/types';

import { DOWNLOAD_SCHEMA_VERSION, type DownloadCollection, type DownloadRecord, type DownloadsSnapshot, type DownloadState } from './types';

export const EMPTY_SNAPSHOT: DownloadsSnapshot = { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records: {}, collections: {} };

interface V1Record {
  schemaVersion: 1;
  itemId: string;
  serverId: string;
  title?: string;
  state?: string;
  bytesTotal?: number | null;
  bytesDone?: number;
  localPath?: string | null;
  createdAt?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const V1_STATES: Record<string, DownloadState> = {
  queued: 'queued',
  downloading: 'queued',
  paused: 'paused',
  failed: 'failed',
  done: 'completed',
};

/** A v1 path was absolute; v2 keeps paths relative to the document directory. */
export function relativeDir(path: string | null | undefined, itemId: string): { dir: string; file: string } {
  if (!path) return { dir: `downloads/${itemId}`, file: '' };
  const clean = path.replace(/^file:\/\//, '');
  const at = clean.indexOf('/downloads/');
  const rel = at >= 0 ? clean.slice(at + 1) : `downloads/${itemId}/${clean.split('/').pop() ?? ''}`;
  const parts = rel.split('/');
  const file = parts.pop() ?? '';
  return { dir: parts.join('/'), file };
}

function fromV1(v: V1Record, order: number): DownloadRecord | null {
  if (typeof v.itemId !== 'string' || !v.itemId || typeof v.serverId !== 'string') return null;
  const state = V1_STATES[v.state ?? ''] ?? 'failed';
  const { dir, file } = relativeDir(v.localPath, v.itemId);
  const created = v.createdAt ? Date.parse(v.createdAt) : NaN;
  const item: BaseItemDto = { Id: v.itemId, Name: v.title ?? 'Download', ServerId: v.serverId };
  return {
    schemaVersion: DOWNLOAD_SCHEMA_VERSION,
    itemId: v.itemId,
    serverId: v.serverId,
    userId: '',
    kind: 'video',
    item,
    group: { id: v.itemId, name: v.title ?? 'Download', type: 'Single' },
    sort: 0,
    // A completed v1 record without a file cannot play: download it again.
    state: state === 'completed' && !file ? 'failed' : state,
    bytesTotal: typeof v.bytesTotal === 'number' ? v.bytesTotal : null,
    bytesDone: typeof v.bytesDone === 'number' ? v.bytesDone : 0,
    speed: 0,
    progressAt: null,
    attempts: 0,
    retryAt: null,
    error: state === 'completed' && !file ? 'Download again' : null,
    dir,
    mediaFile: file,
    mediaSourceId: v.itemId,
    method: 'original',
    quality: 0,
    images: {},
    subtitles: [],
    hasLyrics: false,
    order,
    createdAt: Number.isFinite(created) ? created : 0,
    completedAt: state === 'completed' && Number.isFinite(created) ? created : null,
  };
}

function isV2Record(v: unknown): v is DownloadRecord {
  return (
    isObject(v) &&
    v.schemaVersion === DOWNLOAD_SCHEMA_VERSION &&
    typeof v.itemId === 'string' &&
    typeof v.state === 'string' &&
    typeof v.dir === 'string' &&
    isObject(v.item)
  );
}

function isCollection(v: unknown): v is DownloadCollection {
  return isObject(v) && typeof v.id === 'string' && Array.isArray(v.itemIds) && isObject(v.item);
}

/**
 * Any saved value to the current snapshot. Downloads that were running when
 * the app stopped go back to `queued`; the manager re-attaches them to the
 * native tasks, or starts them again.
 */
export function migrateSnapshot(raw: unknown): DownloadsSnapshot {
  // v1: a plain list of records.
  if (Array.isArray(raw)) {
    const records: Record<string, DownloadRecord> = {};
    raw.forEach((v, i) => {
      if (isObject(v) && v.schemaVersion === 1) {
        const r = fromV1(v as unknown as V1Record, i);
        if (r) records[r.itemId] = r;
      }
    });
    return { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records, collections: {} };
  }
  if (!isObject(raw)) return EMPTY_SNAPSHOT;
  if (raw.schemaVersion === 1 && Array.isArray(raw.records)) return migrateSnapshot(raw.records);
  if (raw.schemaVersion !== DOWNLOAD_SCHEMA_VERSION) {
    // A newer app wrote this (a downgrade). Keep nothing rather than misread it.
    return EMPTY_SNAPSHOT;
  }
  const records: Record<string, DownloadRecord> = {};
  for (const v of Object.values(isObject(raw.records) ? raw.records : {})) {
    if (!isV2Record(v)) continue;
    const state: DownloadState = v.state === 'downloading' ? 'queued' : v.state === 'cancelled' ? 'cancelled' : v.state;
    if (state === 'cancelled') continue;
    records[v.itemId] = { ...v, state, speed: 0, progressAt: null };
  }
  const collections: Record<string, DownloadCollection> = {};
  for (const v of Object.values(isObject(raw.collections) ? raw.collections : {})) {
    if (isCollection(v)) collections[v.id] = v;
  }
  return { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records, collections };
}
