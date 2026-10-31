import { iptvErrorText, IptvError, isHttpUrl } from '../errors';
import { guideIdFor, isStale, nowNext, progressOf, withProgrammes, EMPTY_GUIDE } from '../guide';
import { addRecent, ALL_GROUP, buildGroups, channelsInGroup, EMPTY_LISTS, FAVOURITES_GROUP, groupKey, MAX_RECENTS, RECENTS_GROUP, toggleFavourite } from '../lists';
import { M3uParser } from '../m3u';
import { EMPTY_PROVIDERS, migrateChannelsFile, migrateGuide, migrateLists, migrateProviders } from '../migrate';
import { buildSearchIndex, foldText, searchChannels } from '../search';
import { bigM3u } from '../test-utils/fixtures';
import type { Channel } from '../types';

const ch = (id: string, name: string, group: string, extra: Partial<Channel> = {}): Channel => ({ id, name, group, ...extra });
const CHANNELS = [ch('a', 'BBC One', 'UK'), ch('b', 'Sport One', 'Sport'), ch('c', 'Café TV', 'France'), ch('d', 'Sport Two', 'Sport'), ch('e', 'Loose', '')];

describe('groups and lists', () => {
  it('puts Favourites and Recently watched first', () => {
    let lists = toggleFavourite(EMPTY_LISTS, 'c');
    lists = toggleFavourite(lists, 'gone');
    lists = addRecent(lists, 'b', 1);
    const groups = buildGroups(CHANNELS, lists);
    expect(groups.map((g) => [g.key, g.label, g.count])).toEqual([
      [FAVOURITES_GROUP, 'Favourites', 1],
      [RECENTS_GROUP, 'Recently watched', 1],
      [ALL_GROUP, 'All channels', 5],
      [groupKey('UK'), 'UK', 1],
      [groupKey('Sport'), 'Sport', 2],
      [groupKey('France'), 'France', 1],
      [groupKey(''), 'Other', 1],
    ]);
    expect(channelsInGroup(CHANNELS, lists, FAVOURITES_GROUP).map((c) => c.id)).toEqual(['c']);
    expect(channelsInGroup(CHANNELS, lists, groupKey('Sport')).map((c) => c.id)).toEqual(['b', 'd']);
    expect(channelsInGroup(CHANNELS, lists, groupKey('')).map((c) => c.id)).toEqual(['e']);
  });

  it('toggles favourites, newest first', () => {
    const a = toggleFavourite(toggleFavourite(EMPTY_LISTS, 'a'), 'b');
    expect(a.favourites).toEqual(['b', 'a']);
    expect(toggleFavourite(a, 'a').favourites).toEqual(['b']);
  });

  it('keeps recents unique, newest first, capped', () => {
    let l = EMPTY_LISTS;
    for (let i = 0; i < MAX_RECENTS + 5; i++) l = addRecent(l, `c${i}`, i);
    l = addRecent(l, 'c34', 100);
    expect(l.recents).toHaveLength(MAX_RECENTS);
    expect(l.recents[0]).toEqual({ id: 'c34', at: 100 });
    expect(new Set(l.recents.map((r) => r.id)).size).toBe(MAX_RECENTS);
  });
});

describe('search', () => {
  it('folds case, accents and punctuation', () => {
    expect(foldText('  Café-TV (HD)! ')).toBe('cafe tv hd');
  });

  it('matches every word, prefix matches first', () => {
    const index = buildSearchIndex(CHANNELS);
    expect(searchChannels(index, 'one').map((c) => c.id)).toEqual(['a', 'b']);
    expect(searchChannels(index, 'sport').map((c) => c.id)).toEqual(['b', 'd']);
    expect(searchChannels(index, 'two sport').map((c) => c.id)).toEqual(['d']);
    expect(searchChannels(index, 'cafe').map((c) => c.id)).toEqual(['c']);
    expect(searchChannels(index, '   ')).toEqual([]);
  });

  it('searches 50 000 channels in well under a frame budget per query', () => {
    const p = new M3uParser();
    p.push(bigM3u(50_000));
    const index = buildSearchIndex(p.end().channels);
    const t0 = Date.now();
    const hits = searchChannels(index, 'channel 4999');
    const ms = Date.now() - t0;
    expect(hits[0].name).toBe('Channel 4999 HD');
    expect(hits.length).toBeGreaterThan(1);
    expect(ms).toBeLessThan(200);
  });
});

describe('guide', () => {
  const progs = [
    { start: 0, stop: 10, title: 'A' },
    { start: 10, stop: 20, title: 'B' },
    { start: 20, stop: 30, title: 'C' },
  ];
  it('finds now and next', () => {
    expect(nowNext(progs, 12)).toEqual({ now: progs[1], next: progs[2] });
    expect(nowNext(progs, -5)).toEqual({ now: null, next: progs[0] });
    expect(nowNext(progs, 40)).toEqual({ now: null, next: null });
    expect(nowNext(undefined, 1)).toEqual({ now: null, next: null });
    expect(progressOf(progs[1], 15)).toBe(0.5);
  });
  it('matches guide ids by id, then by name', () => {
    const names = new Map([['bbc one', 'bbc1.example']]);
    expect(guideIdFor(ch('x', 'BBC One', ''), names)).toBe('bbc1.example');
    expect(guideIdFor(ch('x', 'BBC One', '', { epgId: 'own' }), names)).toBe('own');
    expect(guideIdFor(ch('x', 'Other', ''), names)).toBeNull();
  });
  it('merges programmes and knows when they ran out', () => {
    const g = withProgrammes(EMPTY_GUIDE, 'x', progs);
    expect(g.channels.x).toBe(progs);
    expect(g).toMatchObject({ from: 0, to: 30 });
    expect(EMPTY_GUIDE.channels.x).toBeUndefined();
    expect(isStale(g, 'x', 25)).toBe(false);
    expect(isStale(g, 'x', 35)).toBe(true);
    expect(isStale(g, 'y', 0)).toBe(true);
    expect(isStale(withProgrammes(g, 'z', []), 'z', 0)).toBe(false);
  });
});

describe('migrations', () => {
  it('reads v1 providers and drops what it cannot read', () => {
    const snap = migrateProviders({
      schemaVersion: 1,
      providers: {
        p1: { kind: 'xtream', name: 'Home', server: 'http://panel.example.com', userAgent: null, createdAt: 1, updatedAt: 2, refreshedAt: 3, channelCount: 4 },
        p2: { kind: 'm3u', name: 'List', server: 'ignored', hasGuide: true },
        bad: { kind: 'other' },
        noServer: { kind: 'xtream' },
      },
      order: ['p2', 'bad', 'p2'],
    });
    expect(snap.order).toEqual(['p2', 'p1']);
    expect(snap.providers.p1).toMatchObject({ id: 'p1', kind: 'xtream', hasGuide: true, refreshedAt: 3, channelCount: 4 });
    expect(snap.providers.p2).toMatchObject({ server: null, hasGuide: true, refreshedAt: null, channelCount: 0 });
    expect(Object.keys(snap.providers)).toHaveLength(2);
  });

  it('never throws on junk', () => {
    for (const junk of [null, 1, 'x', [], { providers: [] }, { providers: { a: null } }]) {
      expect(() => migrateProviders(junk)).not.toThrow();
      expect(() => migrateLists(junk)).not.toThrow();
      expect(() => migrateGuide(junk)).not.toThrow();
      expect(() => migrateChannelsFile(junk, 'p')).not.toThrow();
    }
    expect(migrateProviders(null)).toBe(EMPTY_PROVIDERS);
    expect(migrateLists({ favourites: ['a', 'a', 3], recents: [{ id: 'b', at: 1 }, { id: 2 }] })).toEqual({ schemaVersion: 2, favourites: ['a'], recents: [{ id: 'b', at: 1 }], snaps: {} });
  });

  it('reads the channel file only for its own provider and version', () => {
    const file = { schemaVersion: 1, providerId: 'p', savedAt: 5, channels: [{ id: 'a', name: 'A' }, { id: 1 }] };
    expect(migrateChannelsFile(file, 'p')).toEqual({ schemaVersion: 1, providerId: 'p', savedAt: 5, channels: [{ id: 'a', name: 'A', group: '' }] });
    expect(migrateChannelsFile(file, 'q')).toBeNull();
    expect(migrateChannelsFile({ ...file, schemaVersion: 99 }, 'p')).toBeNull();
  });

  it('reads the guide window', () => {
    expect(migrateGuide({ schemaVersion: 1, from: 1, to: 2, channels: { a: [{ start: 1, stop: 2, title: 'T' }, { start: 'x' }], b: 'junk' } })).toEqual({
      schemaVersion: 1,
      from: 1,
      to: 2,
      channels: { a: [{ start: 1, stop: 2, title: 'T' }] },
    });
  });
});

describe('errors', () => {
  it('never shows a URL or credentials', () => {
    const e = new Error('GET http://panel.example.com/live/jane/secret/1.ts failed');
    expect(iptvErrorText(e)).not.toMatch(/jane|secret|http/);
    expect(iptvErrorText(new IptvError('http', 403))).toMatch(/user name or password/);
    expect(iptvErrorText(new IptvError('http', 500))).toMatch(/HTTP 500/);
    expect(iptvErrorText(new IptvError('blocked'))).toMatch(/browser/);
  });
  it('knows http addresses', () => {
    expect(isHttpUrl('https://example.com/list.m3u')).toBe(true);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
  });
});
