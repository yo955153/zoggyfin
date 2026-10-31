/**
 * Films and series in an M3U list. Many lists put the provider's films and
 * episodes next to the live channels. An entry is a film when its URL path
 * has `/movie/` or ends in a video file type (`.mp4`, `.mkv`…), and an
 * episode when the path has `/series/`. Episodes whose names carry a season
 * and an episode number ("Show S01 E02", "Show 1x02") are grouped into
 * series; the others count as films. The groups (`group-title`) become the
 * categories. Pure, so it is unit-tested.
 */
import { hashId } from './m3u';
import type { Channel } from './types';
import { extOfUrl } from './vod-stream';
import type { Episode, Film, Season, Series, VodCategory } from './vod-types';
import { splitTitleYear } from './xtream-vod';

const VIDEO_FILES = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'flv', 'webm', 'mpg', 'mpeg', 'divx']);

export interface M3uVod {
  films: Film[];
  filmCategories: VodCategory[];
  series: Series[];
  seriesCategories: VodCategory[];
}

export const EMPTY_M3U_VOD: M3uVod = { films: [], filmCategories: [], series: [], seriesCategories: [] };

export type M3uEntryKind = 'live' | 'film' | 'episode';

/** What an M3U entry is, from its URL. */
export function classifyM3uUrl(url: string | undefined): M3uEntryKind {
  if (!url) return 'live';
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\/series\//.test(path)) return 'episode';
  if (/\/movie\//.test(path)) return 'film';
  const ext = extOfUrl(url);
  return ext && VIDEO_FILES.has(ext) ? 'film' : 'live';
}

/** "Show Name S01 E02", "Show.Name.S01E02.Title", "Show 1x02" → the series name, season and episode. */
export function parseEpisodeName(name: string): { series: string; season: number; number: number; title: string } | null {
  const m = /^(.*?)[\s._-]*(?:S(\d{1,3})\s*[._-]?\s*E(\d{1,4})|(\d{1,2})x(\d{1,3}))(?:[\s._-]+(.*))?$/i.exec(name.trim());
  if (!m) return null;
  const series = m[1].replace(/[._]+/g, ' ').replace(/[\s-]+$/, '').trim();
  if (!series) return null;
  const season = Number(m[2] ?? m[4]);
  const number = Number(m[3] ?? m[5]);
  const title = (m[6] ?? '').replace(/^[-–:.\s]+/, '').trim();
  return { series, season, number, title: title || `Episode ${number}` };
}

function categoryId(group: string): string {
  return group ? `m:${hashId(group)}` : 'm:other';
}

function addCategory(list: VodCategory[], seen: Set<string>, group: string): string {
  const id = categoryId(group);
  if (!seen.has(id)) {
    seen.add(id);
    list.push({ id, name: group || 'Other' });
  }
  return id;
}

/** Splits an M3U channel list into live channels and films and series. */
export function splitM3uVod(entries: readonly Channel[]): { live: Channel[]; vod: M3uVod | null } {
  const live: Channel[] = [];
  const films: Film[] = [];
  const filmCategories: VodCategory[] = [];
  const filmCats = new Set<string>();
  const seriesCategories: VodCategory[] = [];
  const seriesCats = new Set<string>();
  const byKey = new Map<string, Series>();
  for (const e of entries) {
    const kind = classifyM3uUrl(e.url);
    if (kind === 'live' || !e.url) {
      live.push(e);
      continue;
    }
    const ep = kind === 'episode' ? parseEpisodeName(e.name) : null;
    if (ep) {
      const key = `${e.group}|${ep.series.toLowerCase()}`;
      let series = byKey.get(key);
      if (!series) {
        const t = splitTitleYear(ep.series);
        series = { id: `m${hashId(key)}`, name: t.name, categoryId: addCategory(seriesCategories, seriesCats, e.group), episodes: [] };
        if (t.year) series.year = t.year;
        if (e.logo) series.poster = e.logo;
        byKey.set(key, series);
      }
      const episode: Episode = { id: e.id, season: ep.season, number: ep.number, title: ep.title, url: e.url };
      const ext = extOfUrl(e.url);
      if (ext) episode.ext = ext;
      if (e.logo && e.logo !== series.poster) episode.still = e.logo;
      series.episodes?.push(episode);
      continue;
    }
    const t = splitTitleYear(e.name);
    const film: Film = { id: e.id, name: t.name, categoryId: addCategory(filmCategories, filmCats, e.group), url: e.url };
    if (t.year) film.year = t.year;
    if (e.logo) film.poster = e.logo;
    const ext = extOfUrl(e.url);
    if (ext) film.ext = ext;
    films.push(film);
  }
  const series = [...byKey.values()];
  for (const s of series) s.episodes?.sort((a, b) => a.season - b.season || a.number - b.number);
  if (!films.length && !series.length) return { live, vod: null };
  return { live, vod: { films, filmCategories, series, seriesCategories } };
}

/** The seasons of an M3U series, from its episodes (already in order). */
export function seasonsFromEpisodes(episodes: readonly Episode[]): Season[] {
  const bySeason = new Map<number, Episode[]>();
  for (const ep of episodes) {
    const list = bySeason.get(ep.season) ?? [];
    list.push(ep);
    bySeason.set(ep.season, list);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
    .map(([number, list]) => ({ number, name: number === 0 ? 'Specials' : `Season ${number}`, episodes: list }));
}
