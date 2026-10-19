import type { BaseItemDto } from '@/api/types';

import type { OutboxEntry } from '../outbox';
import { buildIndex, matchItem, relinkDownloads, remapOutbox } from '../relink';
import { rec } from '../test-utils/fixtures';
import type { DownloadCollection } from '../types';

const movie = (over: Partial<BaseItemDto>): BaseItemDto => ({ Type: 'Movie', Name: 'Sample Film', ProductionYear: 2001, ...over });

describe('matchItem', () => {
  const idx = buildIndex([
    movie({ Id: 'n1', ProviderIds: { Tmdb: '603' }, Path: '/media/a.mkv' }),
    movie({ Id: 'n2', Name: 'Other Film', Path: '/media/b.mkv' }),
    movie({ Id: 'n3', Name: 'Third Film', ProductionYear: 1999 }),
    movie({ Id: 'n4', Name: 'Twin', ProductionYear: 2010 }),
    movie({ Id: 'n5', Name: 'Twin', ProductionYear: 2010 }),
  ]);

  it('matches by provider id first', () => {
    expect(matchItem(movie({ Id: 'o1', ProviderIds: { tmdb: '603' }, Path: '/media/b.mkv' }), idx)).toEqual({ id: 'n1', level: 'provider' });
  });
  it('then by path', () => {
    expect(matchItem(movie({ Id: 'o2', Name: 'Renamed', Path: '/media/b.mkv' }), idx)).toEqual({ id: 'n2', level: 'path' });
  });
  it('then by name, year and type', () => {
    expect(matchItem(movie({ Id: 'o3', Name: 'third film', ProductionYear: 1999 }), idx)).toEqual({ id: 'n3', level: 'name' });
  });
  it('finds nothing for no match, another type or two equal candidates', () => {
    expect(matchItem(movie({ Id: 'o4', Name: 'Missing' }), idx)).toBeNull();
    expect(matchItem({ Id: 'o5', Type: 'Episode', Name: 'Third Film', ProductionYear: 1999 }, idx)).toBeNull();
    expect(matchItem(movie({ Id: 'o6', Name: 'Twin', ProductionYear: 2010 }), idx)).toBeNull();
  });
});

describe('relinkDownloads', () => {
  const song = (id: string, name: string, mbid?: string) =>
    rec({ itemId: id, serverId: 'old', group: { id: 'old-album', name: 'Sample Album', type: 'MusicAlbum' }, item: { Id: id, Name: name, Type: 'Audio', Album: 'Sample Album', AlbumId: 'old-album', ProviderIds: mbid ? { MusicBrainzTrack: mbid } : {} } });
  const records = {
    s1: song('s1', 'One', 'mb-1'),
    s2: song('s2', 'Two'),
    other: rec({ itemId: 'other', serverId: 'elsewhere' }),
  };
  const collections: Record<string, DownloadCollection> = {
    'old-album': { id: 'old-album', serverId: 'old', type: 'MusicAlbum', name: 'Sample Album', item: { Id: 'old-album' }, itemIds: ['s1', 's2'], images: {}, dir: 'd', createdAt: 1 },
  };
  const idx = buildIndex([{ Id: 'n1', Type: 'Audio', Name: 'One (remaster)', AlbumId: 'new-album', ProviderIds: { MusicBrainzTrack: 'mb-1' } }]);

  it('moves the matched downloads and keeps the others under the old server', () => {
    const r = relinkDownloads(records, collections, idx, { serverId: 'old' }, { serverId: 'new', userId: 'u9' });
    expect(r.total).toBe(2);
    expect(r.moved).toEqual({ s1: 'n1' });
    expect(Object.keys(r.records).sort()).toEqual(['n1', 'other', 's2']);
    expect(r.records.n1).toMatchObject({ itemId: 'n1', serverId: 'new', userId: 'u9', dir: 'downloads/s1', item: { Id: 'n1', AlbumId: 'new-album' } });
    expect(r.records.n1.group.id).toBe('new-album');
    expect(r.records.s2.serverId).toBe('old');
    expect(r.records.other).toBe(records.other);
    expect(r.collections['old-album'].itemIds).toEqual(['s2']);
    expect(r.collections['new-album']).toMatchObject({ serverId: 'new', itemIds: ['n1'] });
  });
});

describe('remapOutbox', () => {
  const e = (over: Partial<OutboxEntry>): OutboxEntry => ({
    serverId: 'old',
    userId: 'u1',
    itemId: 's1',
    positionTicks: 10,
    runTimeTicks: 100,
    played: false,
    at: 1,
    attempts: 0,
    nextTryAt: 0,
    ...over,
  });

  it('moves the entries of matched items and keeps the rest on the old server', () => {
    const out = remapOutbox([e({}), e({ itemId: 's2' }), e({ serverId: 'elsewhere' })], 'old', { s1: 'n1' }, { serverId: 'new', userId: 'u9' });
    expect(out).toEqual([e({ serverId: 'new', userId: 'u9', itemId: 'n1' }), e({ itemId: 's2' }), e({ serverId: 'elsewhere' })]);
  });

  it('keeps the newest entry when the new server has one for the same item', () => {
    const out = remapOutbox([e({ at: 5 }), e({ serverId: 'new', userId: 'u9', itemId: 'n1', at: 3 })], 'old', { s1: 'n1' }, { serverId: 'new', userId: 'u9' });
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe(5);
  });
});
