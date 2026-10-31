import { browseEntries, defaultGroup, resolveGroup } from '../browse';
import { addRecent, ALL_GROUP, buildGroups, EMPTY_LISTS, FAVOURITES_GROUP, groupKey, RECENTS_GROUP, toggleFavourite } from '../lists';
import { buildSearchIndex, EMPTY_RECENT_SEARCHES, MAX_RECENT_SEARCHES, migrateRecentSearches, rememberSearch, searchChannels } from '../search';
import type { Channel } from '../types';

const ch = (id: string, name: string, group: string, number?: number): Channel => ({ id, name, group, ...(number !== undefined ? { number } : {}) });

const CHANNELS = [
  ch('a', 'BBC One', 'UK', 1),
  ch('b', 'Sport One', 'Sport', 101),
  ch('c', 'Channel 4', 'UK', 4),
  ch('d', 'One Sport', 'Sport', 10),
  ch('e', 'Gone', 'UK', 100),
  ch('f', 'Phone Shop', 'Shopping', 12),
  ch('g', 'News 10', 'News'),
];

describe('channel search ranking', () => {
  const index = buildSearchIndex(CHANNELS);
  const ids = (q: string) => searchChannels(index, q).map((c) => c.id);

  it('puts the exact channel number first, then numbers that start with it, lowest first', () => {
    // 10 exact; 100 and 101 start with 10; "News 10" has 10 in its name.
    expect(ids('10')).toEqual(['d', 'e', 'b', 'g']);
    expect(ids('4')).toEqual(['c']);
  });

  it('ranks name start, then word start, then anywhere', () => {
    // "One Sport" starts with "one"; "BBC One" and "Sport One" have a word that starts with it; "Gone" and "Phone Shop" only hold it.
    expect(ids('one')).toEqual(['d', 'a', 'b', 'e', 'f']);
  });

  it('needs every word, in any order', () => {
    expect(ids('sport one')).toEqual(['b', 'd']);
    expect(ids('one sport')).toEqual(['d', 'b']);
  });

  it('finds nothing for an empty query and keeps the limit', () => {
    expect(ids('  ')).toEqual([]);
    expect(searchChannels(index, 'o', 2)).toHaveLength(2);
  });
});

describe('recent searches', () => {
  it('keeps the newest first, unique whatever the case, and capped', () => {
    let r = EMPTY_RECENT_SEARCHES;
    r = rememberSearch(r, 'news');
    r = rememberSearch(r, 'sport');
    r = rememberSearch(r, '  News ');
    expect(r.queries).toEqual(['News', 'sport']);
    for (let i = 0; i < MAX_RECENT_SEARCHES + 3; i++) r = rememberSearch(r, `q${i}`);
    expect(r.queries).toHaveLength(MAX_RECENT_SEARCHES);
    expect(r.queries[0]).toBe(`q${MAX_RECENT_SEARCHES + 2}`);
  });

  it('skips one letter but keeps a one-digit channel number', () => {
    expect(rememberSearch(EMPTY_RECENT_SEARCHES, 'a')).toBe(EMPTY_RECENT_SEARCHES);
    expect(rememberSearch(EMPTY_RECENT_SEARCHES, '7').queries).toEqual(['7']);
  });

  it('returns the same object when the query is already first', () => {
    const r = rememberSearch(EMPTY_RECENT_SEARCHES, 'news');
    expect(rememberSearch(r, 'news')).toBe(r);
  });

  it('reads any saved shape without throwing', () => {
    expect(migrateRecentSearches(null)).toEqual(EMPTY_RECENT_SEARCHES);
    expect(migrateRecentSearches('x')).toEqual(EMPTY_RECENT_SEARCHES);
    expect(migrateRecentSearches({ queries: ['a b', 3, '', 'c'] }).queries).toEqual(['a b', 'c']);
  });
});

describe('browse column', () => {
  const keys = (lists = EMPTY_LISTS) => browseEntries(buildGroups(CHANNELS, lists), [{ key: 'films', label: 'Films' }]).map((e) => e.key);

  it('starts with Search; an empty Favourites comes after All channels; no empty Recently watched', () => {
    expect(keys()).toEqual([
      'search',
      ALL_GROUP,
      FAVOURITES_GROUP,
      'section:films',
      'heading:groups',
      groupKey('UK'),
      groupKey('Sport'),
      groupKey('Shopping'),
      groupKey('News'),
      'providers',
    ]);
  });

  it('puts Favourites and Recently watched first when they have channels', () => {
    const lists = addRecent(toggleFavourite(EMPTY_LISTS, 'c'), 'a', 1);
    expect(keys(lists).slice(0, 4)).toEqual(['search', FAVOURITES_GROUP, RECENTS_GROUP, ALL_GROUP]);
  });

  it('opens on Favourites when it has channels, else All channels; a gone group falls back', () => {
    const none = buildGroups(CHANNELS, EMPTY_LISTS);
    const some = buildGroups(CHANNELS, toggleFavourite(EMPTY_LISTS, 'c'));
    expect(defaultGroup(none)).toBe(ALL_GROUP);
    expect(defaultGroup(some)).toBe(FAVOURITES_GROUP);
    expect(resolveGroup(none, groupKey('Sport'))).toBe(groupKey('Sport'));
    expect(resolveGroup(none, groupKey('Gone'))).toBe(ALL_GROUP);
    expect(resolveGroup(some, null)).toBe(FAVOURITES_GROUP);
  });
});
