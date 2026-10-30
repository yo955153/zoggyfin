/**
 * The genre of the day: one movie or show genre per user and local day,
 * picked from the server's genre list with the day seed. Small genres are
 * skipped, so the row never shows two or three lonely tiles. Pure, so it is
 * unit-tested.
 */
import type { BaseItemDto } from '@/api/types';

import { hashSeed } from './daily';

/** A genre needs at least this many movies and shows to be picked. */
export const MIN_GENRE_ITEMS = 4;
/** How many items of the genre the server is asked for. */
export const GENRE_POOL_SIZE = 40;
/** At most this many tiles in the row. */
export const GENRE_ROW_SIZE = 20;

/** Movies plus shows in a genre (`ItemCounts`). An older server without the counts gives `ChildCount`. */
export function genreSize(genre: BaseItemDto): number {
  if (genre.MovieCount == null && genre.SeriesCount == null) return genre.ChildCount ?? 0;
  return (genre.MovieCount ?? 0) + (genre.SeriesCount ?? 0);
}

/**
 * The genre for `seed` (one per user and day), or null when no genre is
 * big enough. The list is sorted by Id first, so the server's order does
 * not change the pick.
 */
export function pickDailyGenre(
  genres: readonly BaseItemDto[] | null | undefined,
  seed: string,
  min = MIN_GENRE_ITEMS,
): BaseItemDto | null {
  const eligible = (genres ?? [])
    .filter((g) => !!g.Id && !!g.Name?.trim() && genreSize(g) >= min)
    .sort((a, b) => ((a.Id ?? '') < (b.Id ?? '') ? -1 : 1));
  if (!eligible.length) return null;
  return eligible[hashSeed(seed) % eligible.length];
}

/** The row title. "Genre of the day" reads right at any hour. */
export function spotlightTitle(genre: BaseItemDto): string {
  return `Genre of the day: ${genre.Name?.trim() ?? ''}`;
}

/** The row: unwatched items first, each part in the server's order. */
export function spotlightItems(items: readonly BaseItemDto[] | null | undefined, max = GENRE_ROW_SIZE): BaseItemDto[] {
  const list = (items ?? []).filter((it) => !!it.Id);
  const unwatched = list.filter((it) => !it.UserData?.Played);
  const watched = list.filter((it) => !!it.UserData?.Played);
  return [...unwatched, ...watched].slice(0, max);
}
