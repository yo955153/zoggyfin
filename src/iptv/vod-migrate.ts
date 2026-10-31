/**
 * Reads saved film and series data of any version into the current shape.
 * It never throws: a list it cannot read becomes empty, and a cache file it
 * cannot read is null (the catalogue loads again from the provider).
 *
 * v1: the shapes in vod-types.ts (VodLists, VodCacheFile). A later version
 * adds its step here, with a test of the old shape.
 */
import { EMPTY_VOD_LISTS } from './vod-lists';
import { VOD_CACHE_SCHEMA_VERSION, VOD_LISTS_SCHEMA_VERSION, type VodCacheFile, type VodFavourite, type VodLists, type VodPosition } from './vod-types';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function favourite(v: unknown): VodFavourite | null {
  if (!isObject(v) || (v.kind !== 'film' && v.kind !== 'series') || !isStr(v.id) || !isStr(v.name)) return null;
  const f: VodFavourite = { kind: v.kind, id: v.id, name: v.name, at: isNum(v.at) ? v.at : 0 };
  if (isStr(v.poster)) f.poster = v.poster;
  return f;
}

function position(v: unknown): VodPosition | null {
  if (!isObject(v) || (v.kind !== 'film' && v.kind !== 'episode') || !isStr(v.id) || !isNum(v.position)) return null;
  const p: VodPosition = {
    kind: v.kind,
    id: v.id,
    position: Math.max(0, v.position),
    duration: isNum(v.duration) ? Math.max(0, v.duration) : 0,
    at: isNum(v.at) ? v.at : 0,
    finished: v.finished === true,
    title: isStr(v.title) ? v.title : '',
  };
  if (isStr(v.seriesId)) p.seriesId = v.seriesId;
  if (isStr(v.poster)) p.poster = v.poster;
  if (isStr(v.seriesName)) p.seriesName = v.seriesName;
  if (isNum(v.season)) p.season = v.season;
  if (isNum(v.episode)) p.episode = v.episode;
  if (isStr(v.ext)) p.ext = v.ext;
  return p;
}

export function migrateVodLists(raw: unknown): VodLists {
  if (!isObject(raw)) return EMPTY_VOD_LISTS;
  // A newer app version's lists: this version reads the fields it knows.
  const seen = new Set<string>();
  const favourites: VodFavourite[] = [];
  for (const f of Array.isArray(raw.favourites) ? raw.favourites : []) {
    const fav = favourite(f);
    if (!fav || seen.has(`${fav.kind}:${fav.id}`)) continue;
    seen.add(`${fav.kind}:${fav.id}`);
    favourites.push(fav);
  }
  const positions: Record<string, VodPosition> = {};
  if (isObject(raw.positions)) {
    for (const v of Object.values(raw.positions)) {
      const p = position(v);
      if (p) positions[`${p.kind}:${p.id}`] = p;
    }
  }
  return { schemaVersion: VOD_LISTS_SCHEMA_VERSION, favourites, positions };
}

/** A catalogue cache file, or null when it is unreadable, from a newer version or from another provider. */
export function migrateVodCache<T>(raw: unknown, providerId: string, isData: (v: unknown) => v is T): VodCacheFile<T> | null {
  if (!isObject(raw) || raw.providerId !== providerId) return null;
  if (!isNum(raw.schemaVersion) || raw.schemaVersion > VOD_CACHE_SCHEMA_VERSION) return null;
  if (!isData(raw.data)) return null;
  return { schemaVersion: VOD_CACHE_SCHEMA_VERSION, providerId, savedAt: isNum(raw.savedAt) ? raw.savedAt : 0, data: raw.data };
}

/** A list of objects that each have a string `id` and `name` (categories, films, series). */
export function isNamedList<T extends { id: string; name: string }>(v: unknown): v is T[] {
  return Array.isArray(v) && v.every((x) => isObject(x) && isStr(x.id) && typeof x.name === 'string');
}

/** Film or series details: an object (the parsers already cleaned it). */
export function isInfo<T>(v: unknown): v is T {
  return isObject(v);
}
