/**
 * "Because you watched" rows: turns the server's movie recommendations into
 * Home rows. Each category becomes one row, titled from its type and its
 * baseline (the movie, director or actor it comes from). Pure, so it is
 * unit-tested.
 */
import type { BaseItemDto, RecommendationDto } from '@/api/types';

/** At most this many recommendation rows on Home. */
export const MAX_RECOMMENDATION_ROWS = 3;

export interface RecommendationRow {
  /** Stable React key: the category Id, or the title when there is none. */
  key: string;
  title: string;
  items: BaseItemDto[];
}

/** The row title for a category, or null when it has no usable name. */
export function recommendationTitle(type: string | null | undefined, name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n) return null;
  switch (type) {
    case 'SimilarToRecentlyPlayed':
      return `Because you watched ${n}`;
    case 'SimilarToLikedItem':
      return `Because you liked ${n}`;
    case 'HasDirectorFromRecentlyPlayed':
    case 'HasLikedDirector':
      return `Directed by ${n}`;
    case 'HasActorFromRecentlyPlayed':
    case 'HasLikedActor':
      return `Starring ${n}`;
    default:
      // A type from a newer server: the baseline still says what the row is about.
      return `More like ${n}`;
  }
}

/** True when the user has seen the item or has started it (Continue Watching has those). */
function seenOrStarted(item: BaseItemDto): boolean {
  return !!item.UserData?.Played || (item.UserData?.PlaybackPositionTicks ?? 0) > 0;
}

/**
 * The rows to show: titled categories with their unseen items, in the
 * server's order. Empty categories and repeated titles are dropped.
 */
export function recommendationRows(
  categories: readonly RecommendationDto[] | null | undefined,
  max = MAX_RECOMMENDATION_ROWS,
): RecommendationRow[] {
  const rows: RecommendationRow[] = [];
  const titles = new Set<string>();
  for (const cat of categories ?? []) {
    if (rows.length >= max) break;
    const title = recommendationTitle(cat.RecommendationType, cat.BaselineItemName);
    if (!title || titles.has(title)) continue;
    const items = (cat.Items ?? []).filter((it) => !!it.Id && !seenOrStarted(it));
    if (!items.length) continue;
    titles.add(title);
    rows.push({ key: cat.CategoryId || title, title, items });
  }
  return rows;
}
