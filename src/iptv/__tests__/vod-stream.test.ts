import { extOfUrl, m3uVodStream, vodChoices, xtreamEpisodeStream, xtreamFilmStream } from '../vod-stream';

const login = { server: 'http://panel.example.com', username: 'jane', password: 'secret' };
const film = (ext?: string) => ({ id: '501', streamId: 501, ext });
const base = 'http://panel.example.com/movie/jane/secret/501';

describe('film and episode streams per platform', () => {
  it('Android and the Mac app play the file in any container', () => {
    for (const platform of ['android', 'desktop'] as const) {
      expect(xtreamFilmStream(film('mkv'), login, platform, null)).toEqual({ candidates: [{ url: `${base}.mkv`, isHls: false }], unsupported: null, userAgent: null });
      expect(xtreamFilmStream(film('avi'), login, platform, 'UA/1').candidates).toEqual([{ url: `${base}.avi`, isHls: false }]);
    }
  });

  it('iPhone, iPad and Apple TV play MP4, M4V and MOV files as they are', () => {
    for (const ext of ['mp4', 'm4v', 'mov']) {
      expect(xtreamFilmStream(film(ext), login, 'ios', null)).toEqual({ candidates: [{ url: `${base}.${ext}`, isHls: false }], unsupported: null, userAgent: null });
    }
    expect(xtreamFilmStream(film('mp4'), login, 'tvos', null).candidates).toEqual([{ url: `${base}.mp4`, isHls: false }]);
  });

  it('iPhone and iPad try the HLS form of an MKV film, then say why it does not play', () => {
    const r = xtreamFilmStream(film('mkv'), login, 'ios', null);
    expect(r.candidates).toEqual([{ url: `${base}.m3u8`, isHls: true }]);
    expect(r.unsupported).toMatch(/MKV file.*iPhone and iPad play MP4 and HLS only/);
    expect(r.unsupported).not.toMatch(/secret|panel/);
    expect(xtreamFilmStream(film('mkv'), login, 'tvos', null).unsupported).toMatch(/Apple TV/);
  });

  it('a browser plays MP4 and WebM, tries MKV as a file first, and else the HLS form', () => {
    expect(xtreamFilmStream(film('webm'), login, 'web', null).candidates).toEqual([{ url: `${base}.webm`, isHls: false }]);
    expect(xtreamFilmStream(film('mkv'), login, 'web', null).candidates).toEqual([
      { url: `${base}.mkv`, isHls: false },
      { url: `${base}.m3u8`, isHls: true },
    ]);
    const avi = xtreamFilmStream(film('avi'), login, 'web', null);
    expect(avi.candidates).toEqual([{ url: `${base}.m3u8`, isHls: true }]);
    expect(avi.unsupported).toMatch(/AVI file.*browser/);
  });

  it('an HLS film plays as HLS everywhere, and a film with no type is tried as MP4', () => {
    for (const p of ['ios', 'web', 'android'] as const) expect(xtreamFilmStream(film('m3u8'), login, p, null).candidates).toEqual([{ url: `${base}.m3u8`, isHls: true }]);
    expect(xtreamFilmStream({ id: '501' }, login, 'ios', null).candidates).toEqual([{ url: `${base}.mp4`, isHls: false }]);
  });

  it('builds episode streams from the episode id', () => {
    expect(xtreamEpisodeStream({ id: '9001', ext: 'mkv' }, login, 'android', null).candidates).toEqual([{ url: 'http://panel.example.com/series/jane/secret/9001.mkv', isHls: false }]);
    const ios = xtreamEpisodeStream({ id: '9001', ext: 'mkv' }, login, 'ios', null);
    expect(ios.candidates).toEqual([{ url: 'http://panel.example.com/series/jane/secret/9001.m3u8', isHls: true }]);
    expect(ios.unsupported).toMatch(/^This episode/);
  });

  it('M3U entries: their own URL, and the HLS form for the panel shape', () => {
    expect(m3uVodStream('https://cdn.example.com/vod/film.mp4?token=abc', 'ios', 'film', null).candidates).toEqual([{ url: 'https://cdn.example.com/vod/film.mp4?token=abc', isHls: false }]);
    expect(m3uVodStream('http://panel.example.com/movie/jane/secret/501.mkv', 'ios', 'film', 'UA')).toMatchObject({
      candidates: [{ url: 'http://panel.example.com/movie/jane/secret/501.m3u8', isHls: true }],
      userAgent: 'UA',
    });
    const other = m3uVodStream('https://cdn.example.com/a/film.mkv', 'ios', 'film', null);
    expect(other.candidates).toEqual([]);
    expect(other.unsupported).toMatch(/MKV/);
  });

  it('reads the container of a URL', () => {
    expect(extOfUrl('http://x.example.com/a/b.MKV?x=1#y')).toBe('mkv');
    expect(extOfUrl('http://x.example.com/a/b')).toBeUndefined();
    expect(vodChoices('u', 'mp4', null, 'web', 'film')).toEqual({ candidates: [{ url: 'u', isHls: false }], unsupported: null });
  });
});
