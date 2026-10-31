/**
 * Favourite films and series and the resume positions of one provider. The
 * positions stay on this device (they never go to Jellyfin). Rules:
 *
 * - A position under 30 s is not a place to resume: it is dropped.
 * - At 92 % or more, or with less than 2 minutes left, the title is finished:
 *   it leaves Continue watching and plays from the start next time.
 * - Continue watching shows the unfinished titles, newest first.
 * - A series resumes on its last unfinished episode, else on the episode
 *   after the last finished one, else on the first episode.
 *
 * Pure, so it is unit-tested; `vod-store.ts` saves the lists.
 */
import type { Episode, Season, VodFavourite, VodKind, VodLists, VodPosition } from './vod-types';
import { VOD_LISTS_SCHEMA_VERSION } from './vod-types';

export const EMPTY_VOD_LISTS: VodLists = { schemaVersion: VOD_LISTS_SCHEMA_VERSION, favourites: [], positions: {} };

export const MIN_RESUME_SECONDS = 30;
export const FINISHED_FRACTION = 0.92;
export const FINISHED_REMAINING_SECONDS = 120;
export const MAX_POSITIONS = 500;
export const MAX_VOD_FAVOURITES = 2000;

export function positionKey(kind: 'film' | 'episode', id: string): string {
  return `${kind}:${id}`;
}

export function isVodFavourite(lists: VodLists, kind: VodKind, id: string): boolean {
  return lists.favourites.some((f) => f.kind === kind && f.id === id);
}

/** Adds (first) or removes a favourite. */
export function toggleVodFavourite(lists: VodLists, fav: Omit<VodFavourite, 'at'>, at: number): VodLists {
  const has = isVodFavourite(lists, fav.kind, fav.id);
  const favourites = has
    ? lists.favourites.filter((f) => !(f.kind === fav.kind && f.id === fav.id))
    : [{ ...fav, at }, ...lists.favourites].slice(0, MAX_VOD_FAVOURITES);
  return { ...lists, favourites };
}

export function favouritesOf(lists: VodLists, kind: VodKind): VodFavourite[] {
  return lists.favourites.filter((f) => f.kind === kind);
}

/** True when a position at `position` of `duration` seconds counts as watched to the end. */
export function isFinished(position: number, duration: number): boolean {
  if (!(duration > 0)) return false;
  return position >= duration * FINISHED_FRACTION || (duration > FINISHED_REMAINING_SECONDS * 4 && duration - position <= FINISHED_REMAINING_SECONDS);
}

/**
 * Saves where a title stopped. Returns the same object when nothing changes,
 * so a caller can skip the write.
 */
export function withPosition(lists: VodLists, entry: Omit<VodPosition, 'finished' | 'at'>, at: number, ended = false): VodLists {
  const key = positionKey(entry.kind, entry.id);
  const prev = lists.positions[key];
  const finished = ended || isFinished(entry.position, entry.duration);
  if (!finished && entry.position < MIN_RESUME_SECONDS) {
    // Started again and left early: the old position is no longer where the person is.
    if (!prev || prev.finished) return lists;
    const { [key]: _gone, ...rest } = lists.positions;
    return { ...lists, positions: rest };
  }
  if (prev && prev.finished === finished && Math.abs(prev.position - entry.position) < 1 && prev.duration === entry.duration) return lists;
  const next: VodPosition = { ...entry, position: finished ? 0 : entry.position, finished, at };
  let positions = { ...lists.positions, [key]: next };
  const keys = Object.keys(positions);
  if (keys.length > MAX_POSITIONS) {
    const keep = keys.sort((a, b) => positions[b].at - positions[a].at).slice(0, MAX_POSITIONS);
    positions = Object.fromEntries(keep.map((k) => [k, positions[k]]));
  }
  return { ...lists, positions };
}

/** Where to start a film or an episode: its saved position, or 0. */
export function resumeAt(lists: VodLists, kind: 'film' | 'episode', id: string): number {
  const p = lists.positions[positionKey(kind, id)];
  return p && !p.finished ? p.position : 0;
}

export function positionOf(lists: VodLists, kind: 'film' | 'episode', id: string): VodPosition | null {
  return lists.positions[positionKey(kind, id)] ?? null;
}

/** The unfinished films and episodes, newest first. One episode per series (the latest). */
export function continueWatching(lists: VodLists, kind?: 'film' | 'episode', limit = 20): VodPosition[] {
  const out: VodPosition[] = [];
  const series = new Set<string>();
  const all = Object.values(lists.positions).sort((a, b) => b.at - a.at);
  for (const p of all) {
    if (p.finished || (kind && p.kind !== kind)) continue;
    if (p.kind === 'episode' && p.seriesId) {
      if (series.has(p.seriesId)) continue;
      series.add(p.seriesId);
    }
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** The episodes of a series in play order. */
export function playOrder(seasons: readonly Season[]): Episode[] {
  return seasons.flatMap((s) => s.episodes);
}

export interface SeriesTarget {
  episode: Episode;
  /** Seconds. */
  start: number;
  /** "Play S1 E1", "Resume S1 E3", "Play S1 E4". */
  label: string;
}

export function episodeCode(ep: Pick<Episode, 'season' | 'number'>): string {
  return `S${ep.season} E${ep.number}`;
}

/** What the Play button of a series plays. Null for a series with no episodes. */
export function seriesTarget(seasons: readonly Season[], lists: VodLists): SeriesTarget | null {
  const order = playOrder(seasons);
  if (!order.length) return null;
  let last: { index: number; p: VodPosition } | null = null;
  for (let index = 0; index < order.length; index++) {
    const p = lists.positions[positionKey('episode', order[index].id)];
    if (p && (!last || p.at > last.p.at)) last = { index, p };
  }
  if (last && !last.p.finished) {
    const ep = order[last.index];
    return { episode: ep, start: last.p.position, label: `Resume ${episodeCode(ep)}` };
  }
  const ep = last ? order[last.index + 1] : order[0];
  if (!ep) {
    // The last episode is finished: start the series again.
    return { episode: order[0], start: 0, label: `Play ${episodeCode(order[0])}` };
  }
  return { episode: ep, start: resumeAt(lists, 'episode', ep.id), label: `Play ${episodeCode(ep)}` };
}

/** The fraction played of a title for its progress bar, or null. */
export function playedFractionOf(p: VodPosition | null): number | null {
  if (!p || p.finished || !(p.duration > 0)) return null;
  return Math.min(1, Math.max(0, p.position / p.duration));
}
