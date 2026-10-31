/**
 * Channel search, by name and by channel number. The index keeps one folded
 * name per channel (lower case, no accents, punctuation as spaces), built
 * once per channel list.
 *
 * A query matches a name when every word of it is in the name. A query of
 * digits only also matches channel numbers. The order, best first:
 * 1. the channel number is the query ("101"),
 * 2. the channel number starts with the query ("10" finds 100 to 109),
 * 3. the name starts with the query's first word,
 * 4. a word of the name starts with it,
 * 5. the name holds it anywhere.
 * Inside a step, the provider's list order. 50 000 names search in a few
 * milliseconds, so the results follow every key press.
 *
 * Recent searches: the last queries, newest first, saved per provider.
 * Pure, so it is unit-tested.
 */
import type { Channel } from './types';

export interface SearchIndex {
  channels: readonly Channel[];
  folded: string[];
  /** The channel numbers as text ('' when a channel has none). */
  numbers: string[];
}

/** Lower case, accents removed, every run of punctuation or space as one space. */
export function foldText(text: string): string {
  let s = text.toLowerCase();
  try {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    // No normalize: keep the accents.
  }
  // ASCII and general punctuation, spelled out: no Unicode property escapes in older Hermes builds.
  return s.replace(/[\s!-/:-@[-`{-~ -¿ -⁯]+/g, ' ').trim();
}

export function buildSearchIndex(channels: readonly Channel[]): SearchIndex {
  return {
    channels,
    folded: channels.map((c) => ` ${foldText(c.name)} `),
    numbers: channels.map((c) => (c.number !== undefined && c.number !== null ? String(c.number) : '')),
  };
}

/** The number of match steps (see the module comment). */
const STEPS = 5;

/** A search hit with its match step (0 is the best; see the module comment). */
export interface RankedHit {
  channel: Channel;
  step: number;
}

/** Channels that match the query, best first (see the module comment). */
export function searchChannels(index: SearchIndex, query: string, limit = 200): Channel[] {
  return searchChannelsRanked(index, query, limit).map((h) => h.channel);
}

/** The same as `searchChannels`, with the match step of each hit, so hits of several lists can merge. */
export function searchChannelsRanked(index: SearchIndex, query: string, limit = 200): RankedHit[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const digits = /^\d+$/.test(query.trim()) ? query.trim() : null;
  const lead = ` ${words[0]}`;
  const buckets: Channel[][] = Array.from({ length: STEPS }, () => []);
  const { folded, channels, numbers } = index;
  // The best steps fill first; stop once the first three hold the limit (later steps cannot rank higher).
  let top = 0;
  for (let i = 0; i < folded.length && top < limit; i++) {
    const num = numbers[i];
    if (digits && num) {
      if (num === digits) {
        buckets[0].push(channels[i]);
        top++;
        continue;
      }
      if (num.startsWith(digits)) {
        buckets[1].push(channels[i]);
        top++;
        continue;
      }
    }
    const name = folded[i];
    let ok = true;
    for (const w of words) {
      if (!name.includes(w)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (name.startsWith(lead)) {
      buckets[2].push(channels[i]);
      top++;
    } else if (name.includes(lead)) buckets[3].push(channels[i]);
    else buckets[4].push(channels[i]);
  }
  // A number prefix: lower numbers first (10, 100, 101 … rather than the list order).
  buckets[1].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const out: RankedHit[] = [];
  for (let step = 0; step < STEPS; step++) {
    for (const channel of buckets[step]) {
      if (out.length >= limit) return out;
      out.push({ channel, step });
    }
  }
  return out;
}

/** How many recent searches are kept. */
export const MAX_RECENT_SEARCHES = 8;

export const RECENT_SEARCHES_SCHEMA_VERSION = 1;

export interface RecentSearches {
  schemaVersion: number;
  queries: string[];
}

export const EMPTY_RECENT_SEARCHES: RecentSearches = { schemaVersion: RECENT_SEARCHES_SCHEMA_VERSION, queries: [] };

/**
 * Puts a query first in the recent searches. A query shorter than two
 * characters is not kept (a channel number of one digit is: it is a full
 * search on a TV remote). The same query in another case replaces the old one.
 */
export function rememberSearch(recent: RecentSearches, query: string, max: number = MAX_RECENT_SEARCHES): RecentSearches {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q || (q.length < 2 && !/^\d$/.test(q))) return recent;
  const key = foldText(q);
  const rest = recent.queries.filter((x) => foldText(x) !== key);
  if (recent.queries[0] === q) return recent;
  return { schemaVersion: RECENT_SEARCHES_SCHEMA_VERSION, queries: [q, ...rest].slice(0, max) };
}

/** Saved recent searches of any shape. Never throws: an unknown shape is no searches. */
export function migrateRecentSearches(raw: unknown): RecentSearches {
  if (!raw || typeof raw !== 'object') return EMPTY_RECENT_SEARCHES;
  const queries = (raw as { queries?: unknown }).queries;
  if (!Array.isArray(queries)) return EMPTY_RECENT_SEARCHES;
  return {
    schemaVersion: RECENT_SEARCHES_SCHEMA_VERSION,
    queries: queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, MAX_RECENT_SEARCHES),
  };
}
