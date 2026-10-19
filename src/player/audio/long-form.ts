/**
 * Long-form audio: recitations, audiobooks, lectures, podcasts. These get
 * the long-form player (speed, ±15/30 s, sleep timer, per-item resume).
 * Pure, so the rules are unit-tested.
 */

interface ItemLike {
  Type?: string | null;
  RunTimeTicks?: number | null;
  Genres?: readonly string[] | null;
  CollectionType?: string | null;
}

/** One item this long is long-form on its own. */
export const LONG_ITEM_SECONDS = 20 * 60;
/** An album whose typical track is this long holds talks or recitations, not songs. */
export const LONG_ALBUM_MEDIAN_SECONDS = 10 * 60;

const SPOKEN_GENRES = /audio ?books?|spoken|speech|lecture|talk|podcast|sermon|recitation|quran|qur'an|tilawa|drama|story|stories/i;

function seconds(ticks: number | null | undefined): number {
  return ticks ? ticks / 10_000_000 : 0;
}

/** Audiobook libraries ("books") hold long-form audio. */
export function isLongFormLibrary(view: Pick<ItemLike, 'CollectionType'> | null | undefined): boolean {
  return view?.CollectionType === 'books' || view?.CollectionType === 'audiobooks';
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** True for one item: an audiobook, an item over 20 minutes, or a spoken-word genre. */
export function isLongFormItem(item: ItemLike): boolean {
  if (item.Type === 'AudioBook') return true;
  if (seconds(item.RunTimeTicks) >= LONG_ITEM_SECONDS) return true;
  return !!item.Genres?.some((g) => SPOKEN_GENRES.test(g));
}

/** True for a list (album, playlist, folder): any long-form signal, or long tracks on average. */
export function isLongFormList(items: readonly ItemLike[], context?: ItemLike | null, library?: ItemLike | null): boolean {
  if (isLongFormLibrary(library)) return true;
  if (context && (context.Type === 'AudioBook' || context.Genres?.some((g) => SPOKEN_GENRES.test(g)))) return true;
  if (items.some((i) => i.Type === 'AudioBook')) return true;
  const lengths = items.map((i) => seconds(i.RunTimeTicks)).filter((s) => s > 0);
  if (lengths.length === 1) return (lengths[0] as number) >= LONG_ITEM_SECONDS;
  return median(lengths) >= LONG_ALBUM_MEDIAN_SECONDS;
}
