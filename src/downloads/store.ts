/**
 * The downloads store: every record and collection, saved to MMKV. Screens
 * read it through the hooks in `index.ts`; only the manager writes it.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

import { EMPTY_SNAPSHOT, migrateSnapshot } from './migrate';
import { fraction, isFileMissing } from './state-machine';
import {
  DOWNLOAD_SCHEMA_VERSION,
  type DownloadCollection,
  type DownloadRecord,
  type DownloadsSnapshot,
  type DownloadStatus,
} from './types';

/** v1 lived under the same key in the phase 1 stub; migrate.ts reads both shapes. */
export const STORE_KEY = 'downloads.records';

export interface DownloadsState {
  records: Record<string, DownloadRecord>;
  collections: Record<string, DownloadCollection>;
  /** The document directory (file:// URI), once the engine starts. */
  documentsDir: string | null;
}

function load(): DownloadsSnapshot {
  try {
    return migrateSnapshot(readJson<unknown>(STORE_KEY, EMPTY_SNAPSHOT));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

const initial = load();

export const useDownloadsStore = create<DownloadsState>(() => ({
  records: initial.records,
  collections: initial.collections,
  documentsDir: null,
}));

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveNow() {
  saveTimer = null;
  const { records, collections } = useDownloadsStore.getState();
  writeJson(STORE_KEY, { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records, collections } satisfies DownloadsSnapshot);
}

/** Saves at once for state changes, and at most every 2 s for progress. */
export function persist(soon = false): void {
  if (soon) {
    if (saveTimer) clearTimeout(saveTimer);
    saveNow();
    return;
  }
  if (!saveTimer) saveTimer = setTimeout(saveNow, 2000);
}

export function downloadsState(): DownloadsState {
  return useDownloadsStore.getState();
}

export function putRecord(r: DownloadRecord, soon = true): void {
  useDownloadsStore.setState((s) => ({ records: { ...s.records, [r.itemId]: r } }));
  persist(soon);
}

export function patchRecord(itemId: string, fn: (r: DownloadRecord) => DownloadRecord, soon = true): DownloadRecord | null {
  const cur = useDownloadsStore.getState().records[itemId];
  if (!cur) return null;
  const next = fn(cur);
  if (next === cur) return cur;
  putRecord(next, soon);
  return next;
}

export function dropRecord(itemId: string): void {
  useDownloadsStore.setState((s) => {
    const records = { ...s.records };
    delete records[itemId];
    // A collection keeps only the items that are still here.
    const collections: Record<string, DownloadCollection> = {};
    for (const c of Object.values(s.collections)) {
      const ids = c.itemIds.filter((id) => id !== itemId && records[id]);
      if (ids.length) collections[c.id] = ids.length === c.itemIds.length ? c : { ...c, itemIds: ids };
    }
    return { records, collections };
  });
  persist(true);
}

export function putCollection(c: DownloadCollection): void {
  useDownloadsStore.setState((s) => ({ collections: { ...s.collections, [c.id]: c } }));
  persist(true);
}

export function dropCollection(id: string): void {
  useDownloadsStore.setState((s) => {
    const collections = { ...s.collections };
    delete collections[id];
    return { collections };
  });
  persist(true);
}

// ---- Status (pure, unit-tested) ------------------------------------------------

/** Rounded to whole percent, so rows re-render once per percent at most. */
function pct(f: number): number {
  return Math.round(f * 100) / 100;
}

export function recordStatus(r: DownloadRecord | undefined): DownloadStatus {
  if (!r || r.state === 'cancelled') return { state: 'none' };
  if (r.state === 'completed') return { state: 'completed' };
  if (isFileMissing(r)) return { state: 'failed', progress: 0, missing: true };
  return { state: r.state, progress: pct(fraction(r)) };
}

/** A container: done when every item is done; else the state of the busiest item and the byte progress. */
export function collectionStatus(c: DownloadCollection | undefined, records: Record<string, DownloadRecord>): DownloadStatus {
  if (!c) return { state: 'none' };
  const list = c.itemIds.map((id) => records[id]).filter((r): r is DownloadRecord => !!r && r.state !== 'cancelled');
  if (!list.length) return { state: 'none' };
  if (list.every((r) => r.state === 'completed')) return { state: 'completed' };
  const done = list.reduce((n, r) => n + (r.state === 'completed' ? 1 : fraction(r)), 0);
  const progress = pct(done / list.length);
  if (list.some((r) => r.state === 'downloading')) return { state: 'downloading', progress };
  if (list.some((r) => r.state === 'queued')) return { state: 'queued', progress };
  if (list.some((r) => r.state === 'failed')) return { state: 'failed', progress };
  return { state: 'paused', progress };
}

/** The status of any item id: a record, or a collection. */
export function statusOf(id: string, s: Pick<DownloadsState, 'records' | 'collections'>): DownloadStatus {
  const r = s.records[id];
  if (r) return recordStatus(r);
  return collectionStatus(s.collections[id], s.records);
}
