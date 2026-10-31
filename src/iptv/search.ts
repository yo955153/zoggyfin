/**
 * Channel name search. The index keeps one folded name per channel (lower
 * case, no accents, punctuation as spaces), built once per channel list.
 * A query matches when every word of it is in the name; names that start
 * with the query come first. 50 000 names search in a few milliseconds.
 * Pure, so it is unit-tested.
 */
import type { Channel } from './types';

export interface SearchIndex {
  channels: readonly Channel[];
  folded: string[];
}

/** Lower case, accents removed, every run of punctuation or space as one space. */
export function foldText(text: string): string {
  let s = text.toLowerCase();
  try {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    // No normalize: keep the accents.
  }
  // ASCII and general punctuation, spelled out: no Unicode property escapes in older Hermes builds.
  return s.replace(/[\s!-/:-@[-`{-~\u00a0-\u00bf\u2000-\u206f]+/g, ' ').trim();
}

export function buildSearchIndex(channels: readonly Channel[]): SearchIndex {
  return { channels, folded: channels.map((c) => ` ${foldText(c.name)} `) };
}

/** Channels whose names hold every word of the query. Prefix matches first, then the list order. */
export function searchChannels(index: SearchIndex, query: string, limit = 200): Channel[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const first = ` ${words[0]}`;
  const lead: Channel[] = [];
  const rest: Channel[] = [];
  const { folded, channels } = index;
  for (let i = 0; i < folded.length; i++) {
    const name = folded[i];
    let ok = true;
    for (const w of words) {
      if (!name.includes(w)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (name.startsWith(first)) lead.push(channels[i]);
    else rest.push(channels[i]);
    if (lead.length >= limit) break;
  }
  return lead.concat(rest).slice(0, limit);
}
