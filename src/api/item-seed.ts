/**
 * The item a tile showed, kept for the page it opens. The item page renders
 * at once from it (title, art, year, overview when the tile had it) while
 * the full item loads, instead of a skeleton for the whole request.
 * Also times a press to the page in development builds.
 */
import type { BaseItemDto } from './types';

const MAX = 50;
const seeds = new Map<string, BaseItemDto>();
const pressedAt = new Map<string, number>();

export function seedItem(item: BaseItemDto): void {
  if (!item.Id) return;
  seeds.delete(item.Id);
  seeds.set(item.Id, item);
  if (seeds.size > MAX) {
    const oldest = seeds.keys().next().value;
    if (oldest !== undefined) seeds.delete(oldest);
  }
  if (__DEV__) pressedAt.set(item.Id, Date.now());
}

export function itemSeed(id: string | undefined): BaseItemDto | undefined {
  return id ? seeds.get(id) : undefined;
}

/** Development: logs how long after the press a step of the item page came. */
export function logItemTiming(id: string | undefined, step: string): void {
  if (!__DEV__ || !id) return;
  const at = pressedAt.get(id);
  if (at === undefined) return;
  console.log(`[item ${id.slice(0, 8)}] ${step}: ${Date.now() - at} ms after the press`);
  if (step === 'data loaded') pressedAt.delete(id);
}
