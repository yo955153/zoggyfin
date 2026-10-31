/**
 * Xtream films and series: stream URLs and the answers of `get_vod_categories`,
 * `get_vod_streams`, `get_vod_info`, `get_series_categories`, `get_series` and
 * `get_series_info`. Panels differ a lot: numbers come as strings, empty
 * fields as "", null or [], `info` as [] when it is missing, and episodes as
 * an object of seasons or as an array. Everything that does not read is left
 * out. URLs hold the password: never log them. Pure, so it is unit-tested.
 */
import type { Episode, Film, FilmInfo, Season, Series, SeriesInfo, VodCategory } from './vod-types';
import { num, obj, str, type XtreamLogin } from './xtream';

function q(value: string): string {
  return encodeURIComponent(value);
}

/** A file type that can go into a URL: letters and digits only, lower case. */
export function cleanExt(v: unknown): string | undefined {
  const s = str(v).toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]{2,5}$/.test(s) ? s : undefined;
}

/** The film URL: `/movie/<user>/<pass>/<id>.<ext>`. */
export function xtreamFilmUrl(login: XtreamLogin, streamId: number | string, ext: string): string {
  return `${login.server}/movie/${q(login.username)}/${q(login.password)}/${q(String(streamId))}.${ext}`;
}

/** The episode URL: `/series/<user>/<pass>/<episodeId>.<ext>`. */
export function xtreamEpisodeUrl(login: XtreamLogin, episodeId: string, ext: string): string {
  return `${login.server}/series/${q(login.username)}/${q(login.password)}/${q(episodeId)}.${ext}`;
}

/** Category lists (`get_vod_categories`, `get_series_categories`), in the provider's order. */
export function parseVodCategories(json: unknown): VodCategory[] {
  if (!Array.isArray(json)) return [];
  const out: VodCategory[] = [];
  const seen = new Set<string>();
  for (const c of json) {
    const o = obj(c);
    const id = str(o?.category_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: str(o?.category_name) || 'Other' });
  }
  return out;
}

/** A rating out of 10: `rating` ("7.4", 7.4), else `rating_5based` × 2. 0 and junk mean none. */
export function readRating(o: Record<string, unknown>): number | undefined {
  let r = num(typeof o.rating === 'string' ? o.rating.replace(',', '.') : o.rating);
  if (r === null || r <= 0) {
    const five = num(o.rating_5based);
    r = five !== null && five > 0 ? five * 2 : null;
  }
  if (r === null || r <= 0) return undefined;
  return Math.round(Math.min(10, r) * 10) / 10;
}

/** A year from a number, a date ("2010-07-15") or nothing. */
export function readYear(...values: unknown[]): number | undefined {
  for (const v of values) {
    const n = typeof v === 'number' ? v : Number(/^\s*(\d{4})/.exec(str(v))?.[1] ?? Number.NaN);
    if (Number.isFinite(n) && n >= 1880 && n <= 2100) return Math.trunc(n);
  }
  return undefined;
}

/** Seconds since the epoch (as a number or a string) to ms. */
function readAdded(v: unknown): number | undefined {
  const n = num(v);
  return n !== null && n > 0 ? n * 1000 : undefined;
}

function httpUrl(v: unknown): string | undefined {
  // backdrop_path is often an array of URLs.
  const s = Array.isArray(v) ? str(v.find((x) => typeof x === 'string' && x.trim())) : str(v);
  return /^https?:\/\/\S+$/i.test(s) ? s : undefined;
}

function text(v: unknown, max = 2000): string | undefined {
  const s = str(v).replace(/\s+/g, ' ').trim();
  if (!s || s === 'null' || s === 'N/A') return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The title without a year at the end ("Inception (2010)", "Inception - 2010")
 * and the year it named.
 */
export function splitTitleYear(raw: string): { name: string; year?: number } {
  const name = raw.replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s*(?:\((\d{4})\)|\[(\d{4})\]|-\s*(\d{4}))$/.exec(name);
  if (!m) return { name };
  const year = readYear(m[2] ?? m[3] ?? m[4]);
  return year ? { name: m[1].trim(), year } : { name };
}

function tmdbOf(o: Record<string, unknown>): string | undefined {
  const t = str(o.tmdb ?? o.tmdb_id);
  return /^\d+$/.test(t) && t !== '0' ? t : undefined;
}

/** The films of a category, or of all categories (`get_vod_streams`). */
export function parseVodStreams(json: unknown): Film[] {
  if (!Array.isArray(json)) return [];
  const out: Film[] = [];
  const seen = new Set<string>();
  for (const s of json) {
    const o = obj(s);
    const streamId = num(o?.stream_id);
    if (!o || streamId === null) continue;
    const id = String(streamId);
    if (seen.has(id)) continue;
    seen.add(id);
    const t = splitTitleYear(str(o.name) || str(o.title) || `Film ${id}`);
    const film: Film = { id, name: t.name, categoryId: str(o.category_id), streamId };
    const poster = httpUrl(o.stream_icon) ?? httpUrl(o.cover);
    if (poster) film.poster = poster;
    const year = readYear(o.year, o.releaseDate, o.release_date) ?? t.year;
    if (year) film.year = year;
    const rating = readRating(o);
    if (rating) film.rating = rating;
    const added = readAdded(o.added);
    if (added) film.added = added;
    const ext = cleanExt(o.container_extension);
    if (ext) film.ext = ext;
    const tmdb = tmdbOf(o);
    if (tmdb) film.tmdb = tmdb;
    out.push(film);
  }
  return out;
}

/** The series of a category, or of all (`get_series`). */
export function parseSeriesList(json: unknown): Series[] {
  if (!Array.isArray(json)) return [];
  const out: Series[] = [];
  const seen = new Set<string>();
  for (const s of json) {
    const o = obj(s);
    const seriesId = num(o?.series_id);
    if (!o || seriesId === null) continue;
    const id = String(seriesId);
    if (seen.has(id)) continue;
    seen.add(id);
    const t = splitTitleYear(str(o.name) || str(o.title) || `Series ${id}`);
    const series: Series = { id, name: t.name, categoryId: str(o.category_id), seriesId };
    const poster = httpUrl(o.cover) ?? httpUrl(o.stream_icon);
    if (poster) series.poster = poster;
    const year = readYear(o.year, o.releaseDate, o.release_date) ?? t.year;
    if (year) series.year = year;
    const rating = readRating(o);
    if (rating) series.rating = rating;
    const added = readAdded(o.last_modified ?? o.added);
    if (added) series.added = added;
    const plot = text(o.plot, 600);
    if (plot) series.plot = plot;
    const genre = text(o.genre, 120);
    if (genre) series.genre = genre;
    const tmdb = tmdbOf(o);
    if (tmdb) series.tmdb = tmdb;
    out.push(series);
  }
  return out;
}

/** "02:28:00" or "148 min" or seconds to seconds. */
function readDuration(secs: unknown, clock: unknown): number | undefined {
  const n = num(secs);
  if (n !== null && n > 0) return Math.round(n);
  const c = str(clock);
  const hms = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(c);
  if (hms) {
    const total = hms[3] !== undefined ? +hms[1] * 3600 + +hms[2] * 60 + +hms[3] : +hms[1] * 3600 + +hms[2] * 60;
    return total > 0 ? total : undefined;
  }
  const min = /^(\d+)\s*(?:min|m)?$/i.exec(c);
  return min && +min[1] > 0 ? +min[1] * 60 : undefined;
}

/** `get_vod_info`: the details of a film. Null when the answer is not one. */
export function parseVodInfo(json: unknown): FilmInfo | null {
  const root = obj(json);
  if (!root) return null;
  // `info` is [] when the panel has no details: the film still plays.
  const info = obj(root.info) ?? {};
  const data = obj(root.movie_data) ?? {};
  if (!Object.keys(info).length && !Object.keys(data).length) return null;
  const out: FilmInfo = {};
  const name = splitTitleYear(str(data.name) || str(info.name)).name;
  if (name) out.name = name;
  const plot = text(info.plot ?? info.description);
  if (plot) out.plot = plot;
  const cast = text(info.cast ?? info.actors, 400);
  if (cast) out.cast = cast;
  const director = text(info.director, 200);
  if (director) out.director = director;
  const genre = text(info.genre, 120);
  if (genre) out.genre = genre;
  const duration = readDuration(info.duration_secs, info.duration ?? info.episode_run_time);
  if (duration) out.duration = duration;
  const backdrop = httpUrl(info.backdrop_path) ?? httpUrl(info.backdrop);
  if (backdrop) out.backdrop = backdrop;
  const poster = httpUrl(info.movie_image) ?? httpUrl(info.cover_big);
  if (poster) out.poster = poster;
  const year = readYear(info.year, info.releasedate, info.release_date, info.releaseDate);
  if (year) out.year = year;
  const rating = readRating(info);
  if (rating) out.rating = rating;
  const ext = cleanExt(data.container_extension);
  if (ext) out.ext = ext;
  const release = str(info.releasedate ?? info.release_date ?? info.releaseDate);
  if (/^\d{4}-\d{2}-\d{2}/.test(release)) out.releaseDate = release.slice(0, 10);
  return out;
}

/** "Breaking Bad - S01E02 - Cat's in the Bag" → "Cat's in the Bag". */
export function episodeTitle(raw: string, seriesName: string | undefined, season: number, number: number): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  const sxe = /^(?:.*?[\s._-])?S\d{1,3}\s*E\d{1,4}(?:\s*[-–:.]\s*|\s+|$)/i.exec(t);
  if (sxe) t = t.slice(sxe[0].length).trim();
  else if (seriesName && t.toLowerCase().startsWith(seriesName.toLowerCase())) t = t.slice(seriesName.length).replace(/^\s*[-–:.]\s*/, '').trim();
  return t || `Episode ${number}`;
}

function parseEpisode(v: unknown, seasonHint: number, seriesName: string | undefined): Episode | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.id ?? o.stream_id);
  if (!id) return null;
  const info = obj(o.info) ?? {};
  const season = num(o.season) ?? seasonHint;
  const number = num(o.episode_num) ?? num(o.episode) ?? 0;
  const raw = str(info.name) && !/^S\d+\s*E\d+$/i.test(str(info.name)) ? str(info.name) : str(o.title);
  const ep: Episode = { id, season, number, title: episodeTitle(raw, seriesName, season, number) };
  const ext = cleanExt(o.container_extension);
  if (ext) ep.ext = ext;
  const plot = text(info.plot ?? info.overview, 600);
  if (plot) ep.plot = plot;
  const duration = readDuration(info.duration_secs, info.duration);
  if (duration) ep.duration = duration;
  const still = httpUrl(info.movie_image) ?? httpUrl(info.cover_big);
  if (still) ep.still = still;
  return ep;
}

/** `get_series_info`: seasons with their episodes, in order. Null when the answer is not one. */
export function parseSeriesInfo(json: unknown, seriesName?: string): SeriesInfo | null {
  const root = obj(json);
  if (!root) return null;
  const info = obj(root.info) ?? {};
  const episodes: Episode[] = [];
  const raw = root.episodes;
  if (Array.isArray(raw)) {
    // Some panels send an array of seasons (arrays), others a flat array.
    for (const entry of raw) {
      for (const e of Array.isArray(entry) ? entry : [entry]) {
        const ep = parseEpisode(e, 0, seriesName);
        if (ep) episodes.push(ep);
      }
    }
  } else {
    const bySeason = obj(raw);
    if (bySeason) {
      for (const [key, list] of Object.entries(bySeason)) {
        if (!Array.isArray(list)) continue;
        const hint = num(key) ?? 0;
        for (const e of list) {
          const ep = parseEpisode(e, hint, seriesName);
          if (ep) episodes.push(ep);
        }
      }
    }
  }
  if (!episodes.length && !Object.keys(info).length) return null;
  const meta = new Map<number, { name: string; poster?: string }>();
  if (Array.isArray(root.seasons)) {
    for (const s of root.seasons) {
      const o = obj(s);
      const n = num(o?.season_number);
      if (!o || n === null) continue;
      const poster = httpUrl(o.cover_big) ?? httpUrl(o.cover);
      meta.set(n, { name: text(o.name, 80) ?? `Season ${n}`, ...(poster ? { poster } : {}) });
    }
  }
  const groups = new Map<number, Episode[]>();
  const seen = new Set<string>();
  for (const ep of episodes) {
    if (seen.has(ep.id)) continue;
    seen.add(ep.id);
    const list = groups.get(ep.season) ?? [];
    list.push(ep);
    groups.set(ep.season, list);
  }
  const seasons: Season[] = [...groups.entries()]
    // Specials (season 0) go last.
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
    .map(([n, list]) => {
      const m = meta.get(n);
      const season: Season = {
        number: n,
        name: m?.name ?? (n === 0 ? 'Specials' : `Season ${n}`),
        episodes: list.sort((a, b) => a.number - b.number),
      };
      if (m?.poster) season.poster = m.poster;
      return season;
    });
  const out: SeriesInfo = { seasons };
  const name = splitTitleYear(str(info.name)).name;
  if (name) out.name = name;
  const plot = text(info.plot ?? info.description);
  if (plot) out.plot = plot;
  const cast = text(info.cast, 400);
  if (cast) out.cast = cast;
  const director = text(info.director, 200);
  if (director) out.director = director;
  const genre = text(info.genre, 120);
  if (genre) out.genre = genre;
  const backdrop = httpUrl(info.backdrop_path);
  if (backdrop) out.backdrop = backdrop;
  const poster = httpUrl(info.cover);
  if (poster) out.poster = poster;
  const year = readYear(info.year, info.releaseDate, info.release_date);
  if (year) out.year = year;
  const rating = readRating(info);
  if (rating) out.rating = rating;
  return out;
}
