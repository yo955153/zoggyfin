/** The Downloads tab lists and the offline search. Pure, so they are unit-tested. */
import type { BaseItemDto } from '@/api/types';

import type { DownloadCollection, DownloadRecord } from './types';

export interface DownloadGroupView {
  id: string;
  name: string;
  type: 'Series' | 'MusicAlbum' | 'Single' | 'Collection';
  /** The item to show for the group (the album, the show, or the single item). */
  item: BaseItemDto;
  records: DownloadRecord[];
  bytes: number;
}

export function buildLists(records: Record<string, DownloadRecord>, collections: Record<string, DownloadCollection>) {
  const all = Object.values(records);
  const inProgress = all.filter((r) => r.state !== 'completed' && r.state !== 'cancelled').sort((a, b) => a.order - b.order);
  const byGroup = new Map<string, DownloadGroupView>();
  for (const r of all) {
    if (r.state !== 'completed') continue;
    const g = byGroup.get(r.group.id);
    if (g) {
      g.records.push(r);
      g.bytes += r.bytesDone;
      continue;
    }
    const collection = collections[r.group.id];
    const item: BaseItemDto =
      collection?.item ??
      (r.group.type === 'MusicAlbum'
        ? { Id: r.group.id, Name: r.group.name, Type: 'MusicAlbum', AlbumArtist: r.item.AlbumArtist, ImageTags: r.item.AlbumPrimaryImageTag ? { Primary: r.item.AlbumPrimaryImageTag } : undefined }
        : r.group.type === 'Series'
          ? { Id: r.group.id, Name: r.group.name, Type: 'Series', ImageTags: r.item.SeriesPrimaryImageTag ? { Primary: r.item.SeriesPrimaryImageTag } : undefined }
          : r.item);
    byGroup.set(r.group.id, { id: r.group.id, name: collection?.name ?? r.group.name, type: r.group.type, item, records: [r], bytes: r.bytesDone });
  }
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, records: g.records.sort((a, b) => a.sort - b.sort) }))
    .sort((a, b) => Math.max(...b.records.map((r) => r.completedAt ?? 0)) - Math.max(...a.records.map((r) => r.completedAt ?? 0)));
  const appBytes = all.reduce((n, r) => n + r.bytesDone, 0);
  const activeCount = inProgress.filter((r) => r.state === 'downloading' || r.state === 'queued').length;
  return { inProgress, groups, appBytes, activeCount };
}

/**
 * True when a download belongs to the server. Records with no server Id
 * (from the first phase) count for every server.
 */
export function onServer(r: Pick<DownloadRecord, 'serverId'>, serverId: string | null | undefined): boolean {
  return !serverId || !r.serverId || r.serverId === serverId;
}

/** Only the records (and collections) of one server. Pure. */
export function forServer<T extends Pick<DownloadRecord, 'serverId'>>(all: Record<string, T>, serverId: string | null | undefined): Record<string, T> {
  if (!serverId) return all;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(all)) if (onServer(v, serverId)) out[k] = v;
  return out;
}

export interface OtherServerDownloads {
  serverId: string;
  count: number;
  bytes: number;
}

/** Completed and waiting downloads of the other servers, by server, largest first. Pure. */
export function otherServers(records: Record<string, DownloadRecord>, serverId: string | null | undefined): OtherServerDownloads[] {
  const by = new Map<string, OtherServerDownloads>();
  for (const r of Object.values(records)) {
    if (onServer(r, serverId)) continue;
    const o = by.get(r.serverId) ?? { serverId: r.serverId, count: 0, bytes: 0 };
    o.count += 1;
    o.bytes += r.bytesDone;
    by.set(r.serverId, o);
  }
  return [...by.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Downloaded items that match a search term, grouped like server results. Pure. */
export function searchDownloads(records: Record<string, DownloadRecord>, term: string, serverId?: string | null): BaseItemDto[] {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];
  return Object.values(forServer(records, serverId))
    .filter((r) => r.state === 'completed')
    .filter((r) =>
      [r.item.Name, r.item.Album, r.item.AlbumArtist, r.item.SeriesName, ...(r.item.Artists ?? [])]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(t)),
    )
    .map((r) => r.item);
}

