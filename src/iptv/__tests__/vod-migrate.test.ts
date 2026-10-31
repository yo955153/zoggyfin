import { isNamedList, migrateVodCache, migrateVodLists } from '../vod-migrate';

describe('saved film and series data', () => {
  it('reads v1 lists and drops what it cannot read', () => {
    const raw = {
      schemaVersion: 1,
      favourites: [
        { kind: 'film', id: '1', name: 'A', at: 5, poster: 'https://img.example.com/a.jpg' },
        { kind: 'film', id: '1', name: 'A again', at: 6 },
        { kind: 'show', id: '2', name: 'B' },
        { kind: 'series', id: '3', name: 'C' },
        'junk',
      ],
      positions: {
        'film:1': { kind: 'film', id: '1', position: 120, duration: 600, at: 9, finished: false, title: 'A', ext: 'mkv' },
        'episode:9': { kind: 'episode', id: '9', seriesId: 's', position: -4, at: 1, finished: true, title: 'E', season: 1, episode: 2 },
        bad: { kind: 'film', position: 1 },
      },
    };
    expect(migrateVodLists(raw)).toEqual({
      schemaVersion: 1,
      favourites: [
        { kind: 'film', id: '1', name: 'A', at: 5, poster: 'https://img.example.com/a.jpg' },
        { kind: 'series', id: '3', name: 'C', at: 0 },
      ],
      positions: {
        'film:1': { kind: 'film', id: '1', position: 120, duration: 600, at: 9, finished: false, title: 'A', ext: 'mkv' },
        'episode:9': { kind: 'episode', id: '9', seriesId: 's', position: 0, duration: 0, at: 1, finished: true, title: 'E', season: 1, episode: 2 },
      },
    });
  });

  it('never throws on junk', () => {
    for (const raw of [null, 1, 'x', [], { favourites: 'x', positions: [] }]) {
      expect(migrateVodLists(raw)).toEqual({ schemaVersion: 1, favourites: [], positions: {} });
    }
  });

  it('reads a cache file of this provider and this version only', () => {
    const file = { schemaVersion: 1, providerId: 'p1', savedAt: 7, data: [{ id: '1', name: 'A' }] };
    expect(migrateVodCache(file, 'p1', isNamedList)).toEqual(file);
    expect(migrateVodCache(file, 'p2', isNamedList)).toBeNull();
    expect(migrateVodCache({ ...file, schemaVersion: 2 }, 'p1', isNamedList)).toBeNull();
    expect(migrateVodCache({ ...file, data: [{ id: 1 }] }, 'p1', isNamedList)).toBeNull();
    expect(migrateVodCache('x', 'p1', isNamedList)).toBeNull();
  });
});
