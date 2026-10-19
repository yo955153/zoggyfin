import { buildLists, searchDownloads } from '../lists';
import { audioPlan, extensionOf, groupFor, isDownloadable, sortFor, subtitleFiles, transcodeBitrate, videoPlan } from '../plan';
import { collectionStatus, recordStatus, statusOf } from '../store';
import { rec } from '../test-utils/fixtures';

jest.mock('@/storage/kv', () => {
  const m = new Map<string, string>();
  return { storage: { getString: (k: string) => m.get(k), set: (k: string, v: string) => m.set(k, v), remove: (k: string) => m.delete(k), clearAll: () => m.clear() } };
});

const server = { baseUrl: 'http://server.test', token: 'tok', deviceId: 'dev' };

describe('videoPlan', () => {
  const source = { Id: 'ms1', Container: 'mov,mp4,m4a', Size: 1000, Bitrate: 10_000_000, SupportsDirectPlay: true, MediaStreams: [{ Type: 'Video' as const, Height: 1080 }] };

  it('keeps the original file when it plays here', () => {
    const p = videoPlan(server, 'item', source, 0);
    expect(p.method).toBe('original');
    expect(p.file).toBe('media.mov');
    expect(p.expectedBytes).toBe(1000);
    expect(p.url).toContain('/Videos/item/stream.mov?static=true&mediaSourceId=ms1');
    expect(p.url).toContain('ApiKey=tok');
  });

  it('keeps the original when it is not taller than the quality', () => {
    expect(videoPlan(server, 'item', source, 1080).method).toBe('original');
  });

  it('transcodes when the file is taller than the quality', () => {
    const p = videoPlan(server, 'item', source, 720, { runTimeTicks: 600 * 10_000_000 });
    expect(p.method).toBe('transcode');
    expect(p.file).toBe('media.mp4');
    expect(p.url).toContain('maxHeight=720');
    expect(p.url).toContain('videoBitRate=4000000');
    expect(p.url).toContain('videoCodec=h264');
    expect(p.expectedBytes).toBe(Math.round(((4_000_000 + 192_000) * 600) / 8));
  });

  it('transcodes a file the device cannot open, at no more than its own bitrate', () => {
    const p = videoPlan(server, 'item', { ...source, SupportsDirectPlay: false, Bitrate: 3_000_000 }, 0);
    expect(p.method).toBe('transcode');
    expect(p.url).toContain('videoBitRate=3000000');
    expect(p.url).not.toContain('maxHeight');
  });

  it('has a bitrate per quality', () => {
    expect([0, 1080, 720, 480].map((q) => transcodeBitrate(q as 0))).toEqual([20_000_000, 8_000_000, 4_000_000, 1_500_000]);
  });
});

describe('audioPlan', () => {
  const profile = {
    MaxStreamingBitrate: 200_000_000,
    DirectPlayProfiles: [{ Type: 'Audio' as const, Container: 'mp3', AudioCodec: 'mp3' }],
    TranscodingProfiles: [{ Type: 'Audio' as const, Container: 'mp3', Protocol: 'http' as const, AudioCodec: 'mp3' }],
  };

  it('keeps an mp3 as it is', () => {
    const p = audioPlan(server, { Id: 's', MediaSources: [{ Id: 's', Container: 'mp3', Size: 50, MediaStreams: [{ Type: 'Audio', Codec: 'mp3' }] }] }, profile, 'u', 'ps');
    expect(p).toMatchObject({ method: 'original', file: 'media.mp3', expectedBytes: 50 });
    expect(p.url).toContain('/Audio/s/universal?');
  });

  it('expects an mp3 transcode for other files', () => {
    const p = audioPlan(server, { Id: 's', RunTimeTicks: 100 * 10_000_000, MediaSources: [{ Container: 'ogg', MediaStreams: [{ Type: 'Audio', Codec: 'vorbis' }] }] }, profile, 'u', 'ps');
    expect(p.method).toBe('transcode');
    expect(p.file).toBe('media.mp3');
  });
});

describe('plan helpers', () => {
  it('groups episodes by show and songs by album', () => {
    expect(groupFor({ Id: 'e', Type: 'Episode', SeriesId: 'show', SeriesName: 'Sample Show' })).toEqual({ id: 'show', name: 'Sample Show', type: 'Series' });
    expect(groupFor({ Id: 's', Type: 'Audio', AlbumId: 'al', Album: 'Sample Album' })).toEqual({ id: 'al', name: 'Sample Album', type: 'MusicAlbum' });
    expect(groupFor({ Id: 'm', Type: 'Movie', Name: 'Sample Movie' })).toEqual({ id: 'm', name: 'Sample Movie', type: 'Single' });
  });

  it('sorts seasons and episodes, discs and tracks', () => {
    expect(sortFor({ Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 3 })).toBe(20_003);
    expect(sortFor({ Type: 'Audio', ParentIndexNumber: 1, IndexNumber: 12 })).toBe(1012);
  });

  it('knows what can download (series and seasons too)', () => {
    for (const Type of ['Movie', 'Episode', 'Audio', 'AudioBook', 'MusicAlbum', 'Playlist', 'Season', 'Series']) {
      expect(isDownloadable({ Id: 'x', Type: Type as 'Movie' })).toBe(true);
    }
    expect(isDownloadable({ Id: 'x', Type: 'Person' })).toBe(false);
    expect(isDownloadable({ Type: 'Movie' })).toBe(false);
  });

  it('reads extensions safely', () => {
    expect(extensionOf('mkv,webm', 'mp4')).toBe('mkv');
    expect(extensionOf('', 'mp4')).toBe('mp4');
    expect(extensionOf('../../x', 'mp4')).toBe('mp4');
  });

  it('lists external text subtitles as WebVTT files', () => {
    const subs = subtitleFiles(server, 'item', {
      Id: 'ms',
      MediaStreams: [
        { Type: 'Subtitle', Index: 2, Language: 'eng', IsTextSubtitleStream: true, DisplayTitle: 'English' },
        { Type: 'Subtitle', Index: 3, IsTextSubtitleStream: false },
        { Type: 'Audio', Index: 1 },
      ],
    });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ index: 2, file: 'subtitle-2.vtt', label: 'English' });
    expect(subs[0]?.url).toContain('/Videos/item/ms/Subtitles/2/0/Stream.vtt');
  });
});

describe('status', () => {
  it('maps records and collections', () => {
    expect(recordStatus(undefined)).toEqual({ state: 'none' });
    expect(recordStatus(rec({ state: 'downloading', bytesDone: 45, bytesTotal: 100 }))).toEqual({ state: 'downloading', progress: 0.45 });
    const records = {
      a: rec({ itemId: 'a', state: 'completed' }),
      b: rec({ itemId: 'b', state: 'downloading', bytesDone: 50, bytesTotal: 100 }),
    };
    const col = { id: 'al', serverId: 's', type: 'MusicAlbum', name: 'Sample Album', item: { Id: 'al' }, itemIds: ['a', 'b'], images: {}, dir: 'd', createdAt: 0 };
    expect(collectionStatus(col, records)).toEqual({ state: 'downloading', progress: 0.75 });
    expect(collectionStatus(col, { ...records, b: rec({ itemId: 'b', state: 'completed' }) })).toEqual({ state: 'completed' });
    expect(statusOf('al', { records, collections: { al: col } }).state).toBe('downloading');
    expect(statusOf('zzz', { records, collections: {} })).toEqual({ state: 'none' });
  });
});

describe('lists and search', () => {
  const records = {
    t1: rec({ itemId: 't1', state: 'completed', sort: 2, bytesDone: 10, completedAt: 5, item: { Id: 't1', Name: 'Second Song', Type: 'Audio', Album: 'Sample Album' } }),
    t2: rec({ itemId: 't2', state: 'completed', sort: 1, bytesDone: 20, completedAt: 6, item: { Id: 't2', Name: 'First Song', Type: 'Audio', Album: 'Sample Album' } }),
    m: rec({ itemId: 'm', state: 'downloading', group: { id: 'm', name: 'Sample Movie', type: 'Single' }, order: 1 }),
    q: rec({ itemId: 'q', state: 'queued', group: { id: 'q', name: 'Queued', type: 'Single' }, order: 0 }),
  };

  it('splits in-progress and downloaded, grouped by album', () => {
    const lists = buildLists(records, {});
    expect(lists.inProgress.map((r) => r.itemId)).toEqual(['q', 'm']);
    expect(lists.groups).toHaveLength(1);
    expect(lists.groups[0]?.records.map((r) => r.itemId)).toEqual(['t2', 't1']);
    expect(lists.groups[0]?.bytes).toBe(30);
    expect(lists.activeCount).toBe(2);
  });

  it('searches downloaded items by name and album', () => {
    expect(searchDownloads(records, 'first').map((i) => i.Id)).toEqual(['t2']);
    expect(searchDownloads(records, 'sample album').map((i) => i.Id).sort()).toEqual(['t1', 't2']);
    expect(searchDownloads(records, 's')).toEqual([]);
  });
});
