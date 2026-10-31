import { parseM3u } from '../m3u';
import { classifyM3uUrl, parseEpisodeName, seasonsFromEpisodes, splitM3uVod } from '../m3u-vod';
import { inChunks } from '../test-utils/fixtures';
import { VOD_M3U } from '../test-utils/vod-fixtures';

describe('films and series in an M3U list', () => {
  it('classifies entries by their URL', () => {
    expect(classifyM3uUrl('http://panel.example.com/movie/u/p/1.mkv')).toBe('film');
    expect(classifyM3uUrl('http://panel.example.com/series/u/p/1.mp4')).toBe('episode');
    expect(classifyM3uUrl('https://cdn.example.com/x/film.MP4?token=1')).toBe('film');
    expect(classifyM3uUrl('http://panel.example.com/u/p/1001')).toBe('live');
    expect(classifyM3uUrl('http://stream.example.com/live.ts')).toBe('live');
    expect(classifyM3uUrl('https://cdn.example.com/live/index.m3u8')).toBe('live');
    expect(classifyM3uUrl(undefined)).toBe('live');
  });

  it('reads season and episode numbers from names', () => {
    expect(parseEpisodeName('Harbour Lights S01 E02')).toEqual({ series: 'Harbour Lights', season: 1, number: 2, title: 'Episode 2' });
    expect(parseEpisodeName('Harbour.Lights.S02E10.Storm')).toEqual({ series: 'Harbour Lights', season: 2, number: 10, title: 'Storm' });
    expect(parseEpisodeName('Night Shift 1x03 - Return')).toEqual({ series: 'Night Shift', season: 1, number: 3, title: 'Return' });
    expect(parseEpisodeName('S01E01')).toBeNull();
    expect(parseEpisodeName('Unnumbered Special')).toBeNull();
  });

  it('splits a list into live channels, films and series, with groups as categories', async () => {
    const parsed = await parseM3u(inChunks(VOD_M3U, 50));
    const { live, vod } = splitM3uVod(parsed.channels);
    expect(live.map((c) => c.name)).toEqual(['Example News', 'Radio Example']);
    expect(vod?.filmCategories.map((c) => c.name)).toEqual(['Films | Action', 'Films | Drama', 'Series | Drama']);
    expect(vod?.films.map((f) => [f.name, f.year ?? null, f.ext ?? null])).toEqual([
      ['The Long Night', 2019, 'mkv'],
      ['Quiet Harbour', null, 'mp4'],
      // An episode with no season and episode number counts as a film.
      ['Unnumbered Special', null, 'mp4'],
    ]);
    expect(vod?.films[0].poster).toBe('https://img.example.com/f1.jpg');
    expect(vod?.series).toHaveLength(1);
    const s = vod?.series[0];
    expect(s?.name).toBe('Harbour Lights');
    expect(s?.poster).toBe('https://img.example.com/s77.jpg');
    expect(s?.episodes?.map((e) => `${e.season}x${e.number}`)).toEqual(['1x1', '1x2']);
    expect(vod?.seriesCategories).toEqual([{ id: s?.categoryId, name: 'Series | Drama' }]);
    // Ids stay the same across refreshes.
    expect(splitM3uVod(parsed.channels).vod?.series[0].id).toBe(s?.id);
  });

  it('leaves a list with no films alone', () => {
    const live = [{ id: 'a', name: 'A', group: '', url: 'http://x.example.com/a.ts' }];
    expect(splitM3uVod(live)).toEqual({ live, vod: null });
  });

  it('groups episodes into seasons, specials last', () => {
    const eps = [
      { id: '0', season: 0, number: 1, title: 'x' },
      { id: '1', season: 1, number: 1, title: 'a' },
      { id: '2', season: 2, number: 1, title: 'b' },
    ];
    expect(seasonsFromEpisodes(eps).map((s) => [s.number, s.name])).toEqual([
      [1, 'Season 1'],
      [2, 'Season 2'],
      [0, 'Specials'],
    ]);
  });
});
