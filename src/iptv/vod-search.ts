/**
 * Title search over films and series. The index keeps one folded title per
 * entry (see `foldText`), built once per catalogue. A title matches when
 * every word of the query starts a word of it ("dark kni" finds "The Dark
 * Knight"); a word found inside another word ("night" in "knight") matches
 * too, but ranks last. Ranking, best first:
 *
 * 1. The title is the query.
 * 2. The title starts with the query.
 * 3. Every word of the query starts a word of the title.
 * 4. Every word is somewhere in the title.
 *
 * Ties keep the better rating, then the newer year, then the catalogue order.
 * 20 000 titles search in a few milliseconds. Pure, so it is unit-tested.
 */
import { foldText } from './search';

export interface TitleIndex<T> {
  items: readonly T[];
  folded: string[];
}

export function buildTitleIndex<T extends { name: string }>(items: readonly T[]): TitleIndex<T> {
  return { items, folded: items.map((x) => foldText(x.name)) };
}

/** 0 = no match; higher is better. */
export function titleScore(folded: string, words: readonly string[], query: string): number {
  if (!words.length) return 0;
  const padded = ` ${folded}`;
  let wordStarts = true;
  for (const w of words) {
    if (!padded.includes(` ${w}`)) {
      if (!folded.includes(w)) return 0;
      wordStarts = false;
    }
  }
  if (folded === query) return 4;
  if (folded.startsWith(query)) return 3;
  return wordStarts ? 2 : 1;
}

export function searchTitles<T extends { name: string; rating?: number; year?: number }>(index: TitleIndex<T>, query: string, limit = 120): T[] {
  const q = foldText(query);
  const words = q.split(' ').filter(Boolean);
  if (!words.length) return [];
  const hits: { i: number; score: number }[] = [];
  const { folded, items } = index;
  for (let i = 0; i < folded.length; i++) {
    const score = titleScore(folded[i], words, q);
    if (score) hits.push({ i, score });
  }
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ra = items[a.i].rating ?? 0;
    const rb = items[b.i].rating ?? 0;
    if (rb !== ra) return rb - ra;
    const ya = items[a.i].year ?? 0;
    const yb = items[b.i].year ?? 0;
    if (yb !== ya) return yb - ya;
    return a.i - b.i;
  });
  return hits.slice(0, limit).map((h) => items[h.i]);
}
