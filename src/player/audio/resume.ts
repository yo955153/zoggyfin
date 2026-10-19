/**
 * The shared store of local long-form positions, and the resume point an
 * item page shows ("Resume 12:07").
 */
import type { BaseItemDto } from '@/api/types';
import { storage } from '@/storage/kv';

import { isLongFormItem } from './long-form';
import { PositionStore, resumeSeconds } from './positions';

export const positions = new PositionStore(storage);

/** Ticks to resume a long audio item at, or null when it starts from the beginning (or is not long-form audio). */
export function audioResumeTicks(item: BaseItemDto): number | null {
  if (!item.Id || (item.MediaType !== 'Audio' && item.Type !== 'Audio' && item.Type !== 'AudioBook')) return null;
  if (!isLongFormItem(item)) return null;
  const duration = (item.RunTimeTicks ?? 0) / 10_000_000;
  const s = resumeSeconds(positions.get(item.Id), (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000, duration);
  return s > 0 ? Math.round(s * 10_000_000) : null;
}
