import { EMPTY_SNAPSHOT, migrateSnapshot, relativeDir } from '../migrate';
import { DOWNLOAD_SCHEMA_VERSION } from '../types';
import { rec } from '../test-utils/fixtures';

describe('migrateSnapshot', () => {
  it('reads nothing as an empty snapshot', () => {
    expect(migrateSnapshot(undefined)).toEqual(EMPTY_SNAPSHOT);
    expect(migrateSnapshot('garbage')).toEqual(EMPTY_SNAPSHOT);
    expect(migrateSnapshot(42)).toEqual(EMPTY_SNAPSHOT);
  });

  it('migrates v1 records (a flat list)', () => {
    const v1 = [
      {
        schemaVersion: 1,
        itemId: 'm1',
        serverId: 's1',
        title: 'Sample Movie',
        state: 'done',
        bytesTotal: 100,
        bytesDone: 100,
        localPath: 'file:///var/mobile/Containers/Data/Application/X/Documents/downloads/m1/media.mp4',
        createdAt: '2026-01-02T03:04:05.000Z',
      },
      { schemaVersion: 1, itemId: 'm2', serverId: 's1', title: 'Other', state: 'downloading', bytesTotal: null, bytesDone: 5, localPath: null, createdAt: 'x' },
      { schemaVersion: 1, itemId: 'm3', serverId: 's1', state: 'done', localPath: null },
      { schemaVersion: 1 },
    ];
    const out = migrateSnapshot(v1);
    expect(out.schemaVersion).toBe(DOWNLOAD_SCHEMA_VERSION);
    expect(Object.keys(out.records).sort()).toEqual(['m1', 'm2', 'm3']);
    const m1 = out.records.m1!;
    expect(m1.state).toBe('completed');
    expect(m1.dir).toBe('downloads/m1');
    expect(m1.mediaFile).toBe('media.mp4');
    expect(m1.item.Name).toBe('Sample Movie');
    expect(m1.completedAt).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
    // A running download goes back to the queue.
    expect(out.records.m2!.state).toBe('queued');
    expect(out.records.m2!.createdAt).toBe(0);
    // A "done" record with no file cannot play.
    expect(out.records.m3!.state).toBe('failed');
  });

  it('migrates a v1 object wrapper', () => {
    const out = migrateSnapshot({ schemaVersion: 1, records: [{ schemaVersion: 1, itemId: 'a', serverId: 's', state: 'paused' }] });
    expect(out.records.a!.state).toBe('paused');
  });

  it('keeps v2 records, resets running ones and drops broken ones', () => {
    const good = rec({ itemId: 'g', state: 'downloading', speed: 99, progressAt: 5 });
    const done = rec({ itemId: 'd', state: 'completed' });
    const out = migrateSnapshot({
      schemaVersion: DOWNLOAD_SCHEMA_VERSION,
      records: { g: good, d: done, bad: { itemId: 'bad' }, c: rec({ itemId: 'c', state: 'cancelled' }) },
      collections: { col: { id: 'col', itemIds: ['g'], item: { Id: 'col' } }, broken: { id: 'x' } },
    });
    expect(Object.keys(out.records).sort()).toEqual(['d', 'g']);
    expect(out.records.g!.state).toBe('queued');
    expect(out.records.g!.speed).toBe(0);
    expect(out.records.d!.state).toBe('completed');
    expect(Object.keys(out.collections)).toEqual(['col']);
  });

  it('keeps nothing from a newer schema (a downgrade)', () => {
    expect(migrateSnapshot({ schemaVersion: 99, records: { a: rec() } })).toEqual(EMPTY_SNAPSHOT);
  });
});

describe('relativeDir', () => {
  it('makes absolute paths relative to the documents folder', () => {
    expect(relativeDir('/a/b/Documents/downloads/x/media.mkv', 'x')).toEqual({ dir: 'downloads/x', file: 'media.mkv' });
    expect(relativeDir('media.mp4', 'y')).toEqual({ dir: 'downloads/y', file: 'media.mp4' });
    expect(relativeDir(null, 'z')).toEqual({ dir: 'downloads/z', file: '' });
  });
});
