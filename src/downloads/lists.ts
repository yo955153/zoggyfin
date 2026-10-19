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

/** Downloaded items that match a search term, grouped like server results. Pure. */
export function searchDownloads(records: Record<string, DownloadRecord>, term: string): BaseItemDto[] {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];
  return Object.values(records)
    .filter((r) => r.state === 'completed')
    .filter((r) =>
      [r.item.Name, r.item.Album, r.item.AlbumArtist, r.item.SeriesName, ...(r.item.Artists ?? [])]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(t)),
    )
    .map((r) => r.item);
}

