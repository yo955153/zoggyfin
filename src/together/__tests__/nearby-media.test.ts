import { guestSource, HostShares, mediaBytesPerSecond } from '../nearby-media';

const records: Record<string, unknown> = {};

jest.mock('@/downloads', () => ({
  findDownload: (id: string | null | undefined) => (id ? (records[id] ?? null) : null),
  localFileFor: (id: string) => (records[id] ? `file:///d/${id}.mp4` : null),
  localExtraUri: () => null,
}));

const film = { itemId: 'f1', serverId: 'S1', state: 'completed', mediaFile: 'film.mp4', bytesTotal: 3_600_000_000, bytesDone: 3_600_000_000, item: { RunTimeTicks: 36_000_000_000 }, images: {} };

beforeEach(() => {
  for (const k of Object.keys(records)) delete records[k];
});

describe('nearby media', () => {
  it('gives the mean bytes per second of a file', () => {
    // 3.6 GB over one hour: 1 MB/s (8 Mbit/s).
    expect(mediaBytesPerSecond(3_600_000_000, 36_000_000_000)).toBe(1_000_000);
    expect(mediaBytesPerSecond(0, 1)).toBeNull();
  });

  it('paces the shared file to its bitrate', () => {
    records.f1 = film;
    const sink = { shareFile: jest.fn(), setPace: jest.fn() };
    const shares = new HostShares(sink, 'tok');
    const path = shares.mediaPath('f1');
    expect(path).toBe('/tok/1.mp4');
    expect(sink.shareFile).toHaveBeenCalledWith('/tok/1.mp4', '/d/f1.mp4', 'video/mp4');
    expect(sink.setPace).toHaveBeenCalledWith('/tok/1.mp4', 1_000_000);
  });

  it('works with a build that cannot pace', () => {
    records.f1 = film;
    const sink = { shareFile: jest.fn() };
    expect(new HostShares(sink, 'tok').mediaPath('f1')).toBe('/tok/1.mp4');
  });

  it('a guest on the item’s server gets no host stream', () => {
    const item = { id: 'f2', serverId: 'S1', name: 'Film', type: 'Movie', path: '/tok/1.mp4' };
    expect(guestSource(item, 'http://h', { server: { activeServerId: 'S1', reachable: true } })).toBeNull();
    expect(guestSource(item, 'http://h', { server: { activeServerId: 'S1', reachable: false } })).toEqual({ uri: 'http://h/tok/1.mp4', local: false });
    expect(guestSource(item, 'http://h', { server: { activeServerId: 'S2', reachable: true } })).toEqual({ uri: 'http://h/tok/1.mp4', local: false });
  });
});
