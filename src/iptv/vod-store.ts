/**
 * The state of the films and series: the loaded catalogues (memory only; the
 * files hold them between launches), the details of titles, the M3U films
 * and series, and the favourites and positions of each provider (MMKV).
 * Keys: `<providerId>:<kind>` for a catalogue, `<providerId>:<kind>:<categoryId>`
 * for a category, `<providerId>:<kind>:<id>` for details.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';

import type { M3uVod } from './m3u-vod';
import type { LoadStatus } from './store';
import { EMPTY_VOD_LISTS } from './vod-lists';
import { migrateVodLists } from './vod-migrate';
import type { TitleIndex } from './vod-search';
import type { FilmInfo, SeriesInfo, VodCategory, VodItem, VodKind, VodLists } from './vod-types';

export interface Loaded<T> {
  status: LoadStatus;
  data: T;
  /** A message for the person (never with a URL). */
  error: string | null;
  /** A refresh runs while the saved data shows. */
  refreshing: boolean;
  /** When the data was fetched from the provider, ms (0: never). */
  savedAt: number;
}

export interface AllTitles {
  items: VodItem[];
  index: TitleIndex<VodItem> | null;
}

export type VodInfo = FilmInfo | SeriesInfo;

export interface VodState {
  categories: Record<string, Loaded<VodCategory[]>>;
  lists: Record<string, Loaded<VodItem[]>>;
  all: Record<string, Loaded<AllTitles>>;
  info: Record<string, Loaded<VodInfo | null>>;
  m3u: Record<string, M3uVod>;
  vodLists: Record<string, VodLists>;
}

export const EMPTY_CATEGORIES: Loaded<VodCategory[]> = { status: 'idle', data: [], error: null, refreshing: false, savedAt: 0 };
export const EMPTY_LIST: Loaded<VodItem[]> = { status: 'idle', data: [], error: null, refreshing: false, savedAt: 0 };
export const EMPTY_ALL: Loaded<AllTitles> = { status: 'idle', data: { items: [], index: null }, error: null, refreshing: false, savedAt: 0 };
export const EMPTY_INFO: Loaded<VodInfo | null> = { status: 'idle', data: null, error: null, refreshing: false, savedAt: 0 };

const INITIAL: VodState = { categories: {}, lists: {}, all: {}, info: {}, m3u: {}, vodLists: {} };

export const useVodStore = create<VodState>(() => INITIAL);

export const vodState = () => useVodStore.getState();
export const setVodState = (patch: Partial<VodState>) => useVodStore.setState(patch);

/** Another account signed in: nothing of the old one stays in memory. */
export function resetVodState(): void {
  setVodState(INITIAL);
}

export const catalogueKey = (providerId: string, kind: VodKind) => `${providerId}:${kind}`;
export const categoryKey = (providerId: string, kind: VodKind, categoryId: string) => `${providerId}:${kind}:${categoryId}`;
export const infoKey = (providerId: string, kind: VodKind, id: string) => `${providerId}:${kind}:${id}`;

type Section = 'categories' | 'lists' | 'all' | 'info';

/** Sets part of one entry of a section. */
export function patchVod<S extends Section>(section: S, key: string, empty: VodState[S][string], patch: Partial<VodState[S][string]>): void {
  const st = vodState();
  const current = (st[section] as Record<string, VodState[S][string]>)[key] ?? empty;
  setVodState({ [section]: { ...st[section], [key]: { ...current, ...patch } } } as Partial<VodState>);
}

/** M3U: the films and series of the list (from the channel list, see manager.ts). Null clears them. */
export function setM3uVod(providerId: string, vod: M3uVod | null): void {
  const { [providerId]: _old, ...rest } = vodState().m3u;
  setVodState({ m3u: vod ? { ...rest, [providerId]: vod } : rest });
}

const listsKey = (providerId: string) => `iptv.vod.${providerId}`;

export function loadVodLists(providerId: string): VodLists {
  const raw = readJson<unknown>(listsKey(providerId), null);
  return raw === null ? EMPTY_VOD_LISTS : migrateVodLists(raw);
}

export function saveVodLists(providerId: string, lists: VodLists): void {
  writeJson(listsKey(providerId), lists);
}

/** A provider was removed: its favourites, positions and loaded catalogues go. */
export function removeVodData(providerId: string): void {
  storage.remove(listsKey(providerId));
  const st = vodState();
  const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith(`${providerId}:`) && k !== providerId));
  setVodState({ categories: keep(st.categories), lists: keep(st.lists), all: keep(st.all), info: keep(st.info), m3u: keep(st.m3u), vodLists: keep(st.vodLists) });
}
