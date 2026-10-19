/**
 * The app-level downloads interface. Screens use these hooks and actions and
 * never import the native downloader (it sits behind `engine.native.ts`).
 * On web and TV `supported` is false and the lists stay empty.
 *
 * Look up a download by Jellyfin item id: `findDownload(itemId)`; its file is
 * `localMediaUri(record, documentsDir)` (also `localFileFor(itemId)`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { features } from '@/platform/tv';

import { files } from './files';
import { fileUri, localImageUri, localMediaUri } from './local';
import { downloadManager } from './manager';
import { isDownloadable } from './plan';
import { downloadsState, statusOf, useDownloadsStore } from './store';
import { buildLists, buildServerSections, type DownloadGroupView, forServer, onServer, type ServerSection } from './lists';
import type { DownloadRecord, DownloadStatus } from './types';

export type { DownloadCollection, DownloadRecord, DownloadState, DownloadStatus, LocalSubtitle } from './types';
export { DOWNLOAD_SCHEMA_VERSION } from './types';
export { buildLists, buildServerSections, type DownloadGroupView, onServer, type ServerSection, searchDownloads } from './lists';

export { DOWNLOAD_QUALITY_OPTIONS, isDownloadable } from './plan';
export { etaSeconds, fraction } from './state-machine';
export { chooseMedia, fileUri, localImageUri, localMediaUri } from './local';
export { isNetworkError, serverOrLocal } from './fallback';

/** Reads a local text file (a downloaded subtitle) by its file:// URI. */
export function readLocalText(uri: string): string | null {
  return files.readUriText(uri);
}

/** True where downloads exist (iPhone, iPad, Mac). False on web and TV. */
export const downloadsSupported: boolean = features.downloads && downloadManager.supported;

export const downloads = {
  init: () => downloadManager.init(),
  download: (item: BaseItemDto) => downloadManager.download(item),
  pause: (id: string) => downloadManager.pause(id),
  resume: (id: string) => downloadManager.resume(id),
  retry: (id: string) => downloadManager.retry(id),
  cancel: (id: string) => downloadManager.cancel(id),
  remove: (id: string) => downloadManager.remove(id),
  removeGroup: (id: string) => downloadManager.removeGroup(id),
  pauseAll: () => downloadManager.pauseAll(),
  resumeAll: () => downloadManager.resumeAll(),
  move: (id: string, toIndex: number) => downloadManager.move(id, toIndex),
};

// ---- Lookups (synchronous, for the players) --------------------------------------

/** The download record for a Jellyfin item id, or null. */
export function findDownload(itemId: string | null | undefined): DownloadRecord | null {
  if (!itemId) return null;
  return downloadsState().records[itemId] ?? null;
}

/** The document directory as a file:// URI, once downloads started; null on web. */
export function documentsDir(): string | null {
  return downloadsState().documentsDir;
}

/** The local media file (file:// URI) of a completed download, or null. */
export function localFileFor(itemId: string | null | undefined): string | null {
  return localMediaUri(findDownload(itemId), downloadsState().documentsDir);
}

/** A file in a download's folder (subtitles, lyrics), as a file:// URI. */
export function localExtraUri(record: DownloadRecord, file: string): string | null {
  const dir = downloadsState().documentsDir;
  return dir ? fileUri(dir, `${record.dir}/${file}`) : null;
}

/** Completed downloads of a container (album, playlist, season), in their order; null when there are none. */
export function downloadedChildren(containerId: string | null | undefined): BaseItemDto[] | null {
  if (!containerId) return null;
  const s = downloadsState();
  const c = s.collections[containerId];
  // Item ids are unique across servers, so a container's downloads are found on any server.
  const list = c
    ? c.itemIds.map((id) => s.records[id])
    : Object.values(s.records)
        .filter((r) => r.group.id === containerId)
        .sort((a, b) => a.sort - b.sort);
  const items = list.filter((r): r is DownloadRecord => !!r && r.state === 'completed').map((r) => r.item);
  return items.length ? items : null;
}

/** The saved item (or container) facts, for pages that open with no server. */
export function downloadedItem(id: string): BaseItemDto | null {
  const s = downloadsState();
  return s.records[id]?.item ?? s.collections[id]?.item ?? null;
}

// ---- Hooks -----------------------------------------------------------------------

/** One item's or container's download state, for buttons and row badges. */
export function useDownloadStatus(id: string | null | undefined): DownloadStatus {
  return useDownloadsStore(useShallow((s) => (id && downloadsSupported ? statusOf(id, s) : ({ state: 'none' } as DownloadStatus))));
}

/** A local image for a downloaded item, or null. */
export function useLocalImage(id: string | null | undefined, variant: 'poster' | 'landscape' | 'square' | 'backdrop'): string | null {
  return useDownloadsStore((s) => {
    if (!id || !downloadsSupported) return null;
    const holder = s.records[id] ?? s.collections[id];
    return holder ? localImageUri(holder, s.documentsDir, variant) : null;
  });
}

/**
 * The Downloads tab lists: in progress (every server, queue order), and the
 * completed downloads of every server (`sections`: the active server first,
 * then by server, then by show or album). `groups` are the active server's
 * groups only. `appBytes` counts every server, for the storage bar.
 */
export function useDownloadLists(): {
  inProgress: DownloadRecord[];
  groups: DownloadGroupView[];
  sections: ServerSection[];
  appBytes: number;
  activeCount: number;
} {
  const records = useDownloadsStore((s) => s.records);
  const collections = useDownloadsStore((s) => s.collections);
  const serverId = useSessionStore((s) => s.session?.serverId ?? null);
  return useMemo(() => {
    const all = buildLists(records, collections);
    const sections = buildServerSections(records, collections, serverId);
    const groups = buildLists(forServer(records, serverId), forServer(collections, serverId)).groups;
    return { inProgress: all.inProgress, activeCount: all.activeCount, appBytes: all.appBytes, groups, sections };
  }, [records, collections, serverId]);
}

const groupItems = new Map<string, BaseItemDto>();

/** The item that stands for a show or album group, made from one of its downloads (cached, so it stays the same object). */
function groupItem(r: DownloadRecord): BaseItemDto {
  const hit = groupItems.get(r.group.id);
  if (hit) return hit;
  const item: BaseItemDto =
    r.group.type === 'MusicAlbum'
      ? { Id: r.group.id, Name: r.group.name, Type: 'MusicAlbum', AlbumArtist: r.item.AlbumArtist, ImageTags: r.item.AlbumPrimaryImageTag ? { Primary: r.item.AlbumPrimaryImageTag } : undefined }
      : r.group.type === 'Series'
        ? { Id: r.group.id, Name: r.group.name, Type: 'Series' }
        : r.item;
  groupItems.set(r.group.id, item);
  return item;
}

/** True when a download (by item id) is from a server that is not the active one. */
export function isOtherServerDownload(itemId: string | null | undefined): boolean {
  const s = downloadsState();
  const r = itemId ? (s.records[itemId] ?? s.collections[itemId]) : null;
  const active = useSessionStore.getState().session?.serverId;
  return !!r && !onServer(r, active);
}

/** The download record or collection of another server for this id, or null (reactive). */
export function useOtherServerDownload(id: string | null | undefined): { serverId: string; item: BaseItemDto } | null {
  const active = useSessionStore((s) => s.session?.serverId ?? null);
  return useDownloadsStore(
    useShallow((s) => {
      if (!id) return null;
      const r = s.records[id] ?? s.collections[id];
      if (r) return !onServer(r, active) ? { serverId: r.serverId, item: r.item } : null;
      // A show or album group with no collection record: its items name it.
      const child = Object.values(s.records).find((x) => x.group.id === id);
      if (!child || onServer(child, active)) return null;
      return { serverId: child.serverId, item: groupItem(child) };
    }),
  );
}

/** Deletes every download of a server (when the user removes the server). */
export async function removeServerDownloads(serverId: string): Promise<void> {
  for (const r of Object.values(downloadsState().records)) {
    if (r.serverId === serverId) await downloadManager.remove(r.itemId);
  }
}

/** Free and total bytes on the device, read again every 10 s while shown. Null on web. */
export function useDiskSpace(): { free: number; total: number } | null {
  const [tick, setTick] = useState(0);
  const bytes = useDownloadsStore((s) => Object.values(s.records).reduce((n, r) => n + r.bytesDone, 0));
  useEffect(() => {
    if (!downloadsSupported) return;
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (downloadsSupported ? files.diskSpace() : null), [bytes, tick]);
}

export function canDownload(item: BaseItemDto | undefined): boolean {
  return !!item && downloadsSupported && isDownloadable(item);
}
