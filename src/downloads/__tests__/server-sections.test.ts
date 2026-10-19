import { buildServerSections, searchDownloads } from '../lists';
import { rec } from '../test-utils/fixtures';

const done = (over: Parameters<typeof rec>[0]) => rec({ state: 'completed', completedAt: 2000, bytesDone: 100, mediaFile: 'media.mp3', ...over });

const records = Object.fromEntries(
  [
    done({ itemId: 'a1', serverId: 'server-a', group: { id: 'album-a', name: 'Album A', type: 'MusicAlbum' } }),
    done({ itemId: 'a2', serverId: 'server-a', group: { id: 'album-a', name: 'Album A', type: 'MusicAlbum' } }),
    done({ itemId: 'b1', serverId: 'server-b', bytesDone: 500, item: { Id: 'b1', Name: 'Far Song', Type: 'Audio' }, group: { id: 'album-b', name: 'Album B', type: 'MusicAlbum' } }),
    done({ itemId: 'c1', serverId: 'server-c', bytesDone: 50, kind: 'video', item: { Id: 'c1', Name: 'Film', Type: 'Movie' }, group: { id: 'c1', name: 'Film', type: 'Single' } }),
    rec({ itemId: 'q1', serverId: 'server-b', state: 'queued' }),
  ].map((r) => [r.itemId, r]),
);

describe('buildServerSections', () => {
  it('lists every server: the active one first, then the others by size', () => {
    const sections = buildServerSections(records, {}, 'server-a');
    expect(sections.map((s) => [s.serverId, s.active, s.count, s.bytes])).toEqual([
      ['server-a', true, 2, 200],
      ['server-b', false, 1, 500],
      ['server-c', false, 1, 50],
    ]);
  });

  it('groups each server by album or show, and tags the groups with their server', () => {
    const [a, b] = buildServerSections(records, {}, 'server-a');
    expect(a?.groups.map((g) => [g.id, g.records.length, g.serverId])).toEqual([['album-a', 2, 'server-a']]);
    expect(b?.groups.map((g) => [g.id, g.serverId])).toEqual([['album-b', 'server-b']]);
  });

  it('leaves out waiting downloads and servers with nothing completed', () => {
    const only = { q1: records.q1! };
    expect(buildServerSections(only, {}, 'server-a')).toEqual([]);
  });

  it('counts records with no server Id for the active server', () => {
    const legacy = { l1: done({ itemId: 'l1', serverId: '', group: { id: 'l1', name: 'Old', type: 'Single' } }) };
    expect(buildServerSections(legacy, {}, 'server-a').map((s) => s.serverId)).toEqual(['server-a']);
  });
});

describe('searchDownloads', () => {
  it('finds downloads of every server', () => {
    expect(searchDownloads(records, 'far').map((i) => i.Id)).toEqual(['b1']);
    expect(searchDownloads(records, 'film').map((i) => i.Id)).toEqual(['c1']);
  });
});
