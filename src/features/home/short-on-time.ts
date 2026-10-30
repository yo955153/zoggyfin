/**
 * "Short on time": unwatched movies that fit in an evening gap. The server
 * has no runtime filter, so the app asks for a bounded set (the best-rated
 * unwatched movies) and filters and orders it here. The order is a shuffle
 * that stays the same for the whole day, so the row changes each day but
 * never jumps while the user looks at it. Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';

import { seededShuffle } from './daily';

const TICKS_PER_MINUTE = 600_000_000;

/** Longest runtime that counts as short (minutes). */
export const SHORT_MAX_MINUTES = 100;
/** Shorter than this is a short film or an extra filed as a movie. */
export const SHORT_MIN_MINUTES = 10;
/** How many movies the server is asked for. */
export const SHORT_POOL_SIZE = 100;
/** At most this many tiles in the row. */
export const SHORT_ROW_SIZE = 20;

/** True for an unwatched, not started movie with a known runtime in range. */
export function isShortPick(item: BaseItemDto): boolean {
  if (!item.Id || item.UserData?.Played || (item.UserData?.PlaybackPositionTicks ?? 0) > 0) return false;
  const minutes = (item.RunTimeTicks ?? 0) / TICKS_PER_MINUTE;
  return minutes >= SHORT_MIN_MINUTES && minutes <= SHORT_MAX_MINUTES;
}

/** The row: the short picks of `pool` in the order of `seed` (one per user and day). */
export function shortOnTime(pool: readonly BaseItemDto[] | null | undefined, seed: string, max = SHORT_ROW_SIZE): BaseItemDto[] {
  return seededShuffle((pool ?? []).filter(isShortPick), seed).slice(0, max);
}
