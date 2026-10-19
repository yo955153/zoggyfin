import type { BaseItemDto } from '@/api/types';

export interface SearchSection {
  key: string;
  title: string;
  items: BaseItemDto[];
}

/** Section order and titles. Types not listed here go to "Other". */
const SECTIONS: { key: string; title: string; types: string[] }[] = [
  { key: 'movies', title: 'Movies', types: ['Movie'] },
  { key: 'series', title: 'Shows', types: ['Series'] },
  { key: 'episodes', title: 'Episodes', types: ['Episode'] },
  { key: 'collections', title: 'Collections', types: ['BoxSet'] },
  { key: 'artists', title: 'Artists', types: ['MusicArtist'] },
  { key: 'albums', title: 'Albums', types: ['MusicAlbum'] },
  { key: 'songs', title: 'Songs', types: ['Audio', 'AudioBook'] },
  { key: 'playlists', title: 'Playlists', types: ['Playlist'] },
  { key: 'people', title: 'People', types: ['Person'] },
  { key: 'videos', title: 'Videos', types: ['Video', 'MusicVideo', 'Trailer'] },
];

/**
 * Groups search results by type, in a fixed section order. Duplicate IDs
 * (the same item from two queries) appear once. Empty sections are dropped.
 */
export function groupSearchResults(items: readonly BaseItemDto[]): SearchSection[] {
  const seen = new Set<string>();
  const buckets = new Map<string, BaseItemDto[]>();
  const typeToKey = new Map<string, string>();
  for (const s of SECTIONS) for (const t of s.types) typeToKey.set(t, s.key);

  for (const item of items) {
    if (item.Id) {
      if (seen.has(item.Id)) continue;
      seen.add(item.Id);
    }
    const key = typeToKey.get(item.Type ?? '') ?? 'other';
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }

  const out: SearchSection[] = [];
  for (const s of SECTIONS) {
    const list = buckets.get(s.key);
    if (list?.length) out.push({ key: s.key, title: s.title, items: list });
  }
  const other = buckets.get('other');
  if (other?.length) out.push({ key: 'other', title: 'Other', items: other });
  return out;
}

/** Keeps the 10 most recent distinct searches, newest first. */
export function pushRecentSearch(recent: readonly string[], term: string, max = 10): string[] {
  const t = term.trim();
  if (!t) return [...recent];
  const rest = recent.filter((r) => r.toLowerCase() !== t.toLowerCase());
  return [t, ...rest].slice(0, max);
}
