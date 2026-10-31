import {
  cleanExt,
  episodeTitle,
  parseSeriesInfo,
  parseSeriesList,
  parseVodCategories,
  parseVodInfo,
  parseVodStreams,
  readRating,
  readYear,
  splitTitleYear,
  xtreamEpisodeUrl,
  xtreamFilmUrl,
} from '../xtream-vod';
import { SERIES_INFO, SERIES_INFO_FLAT, SERIES_LIST, VOD_CATEGORIES, VOD_INFO, VOD_INFO_EMPTY, VOD_STREAMS } from '../test-utils/vod-fixtures';

const login = { server: 'http://panel.example.com:8080', username: 'jane doe', password: 'p@ss/1' };

describe('Xtream film and series URLs', () => {
  it('builds the film and episode URLs with the credentials encoded', () => {
    expect(xtreamFilmUrl(login, 501, 'mkv')).toBe('http://panel.example.com:8080/movie/jane%20doe/p%40ss%2F1/501.mkv');
    expect(xtreamEpisodeUrl(login, '9001', 'mp4')).toBe('http://panel.example.com:8080/series/jane%20doe/p%40ss%2F1/9001.mp4');
  });

  it('accepts only plain file types', () => {
    expect(cleanExt('MKV')).toBe('mkv');
    expect(cleanExt('.mp4')).toBe('mp4');
    expect(cleanExt('')).toBeUndefined();
    expect(cleanExt('mp4?x=1')).toBeUndefined();
    expect(cleanExt(null)).toBeUndefined();
  });
});

describe('Xtream catalogue answers', () => {
  it('reads categories once each, in order, and skips the ones with no id', () => {
    expect(parseVodCategories(VOD_CATEGORIES)).toEqual([
      { id: '10', name: 'Action' },
      { id: '11', name: 'Drama' },
      { id: '12', name: 'Other' },
    ]);
    expect(parseVodCategories({ error: 'x' })).toEqual([]);
  });

  it('reads films with numbers as strings, missing posters, ratings as text and years in the name', () => {
    const films = parseVodStreams(VOD_STREAMS);
    expect(films).toEqual([
      {
        id: '501',
        name: 'The Long Night',
        categoryId: '10',
        streamId: 501,
        poster: 'https://img.example.com/posters/501.jpg',
        year: 2019,
        rating: 7.4,
        added: 1690000000000,
        ext: 'mkv',
        tmdb: '12345',
      },
      { id: '502', name: 'Quiet Harbour', categoryId: '11', streamId: 502, year: 2021, rating: 9, added: 1700000000000, ext: 'mp4' },
      { id: '503', name: 'Sea of Glass', categoryId: '10', streamId: 503, year: 2015 },
    ]);
  });

  it('reads series and skips the ones with no id', () => {
    const list = parseSeriesList(SERIES_LIST);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      id: '77',
      name: 'Harbour Lights',
      categoryId: '20',
      seriesId: 77,
      poster: 'https://img.example.com/series/77.jpg',
      year: 2018,
      rating: 8,
      added: 1695000000000,
      plot: 'Life in a small port town.',
      genre: 'Drama',
    });
    expect(list[1]).toEqual({ id: '78', name: 'Night Shift', categoryId: '21', seriesId: 78, year: 2020 });
  });

  it('reads ratings, years and titles from odd values', () => {
    expect(readRating({ rating: '6,5' })).toBe(6.5);
    expect(readRating({ rating: 'N/A', rating_5based: 2 })).toBe(4);
    expect(readRating({ rating: 42 })).toBe(10);
    expect(readRating({})).toBeUndefined();
    expect(readYear('', null, '1999-02-01')).toBe(1999);
    expect(readYear('abc', 12)).toBeUndefined();
    expect(splitTitleYear('  Film  [2001] ')).toEqual({ name: 'Film', year: 2001 });
    expect(splitTitleYear('2001: A Title')).toEqual({ name: '2001: A Title' });
    expect(splitTitleYear('Title (0000)')).toEqual({ name: 'Title (0000)' });
  });
});

describe('Xtream details', () => {
  it('reads the details of a film', () => {
    expect(parseVodInfo(VOD_INFO)).toEqual({
      name: 'The Long Night',
      plot: 'A night watchman finds out what the night hides.',
      cast: 'Jane Doe, Sam Example',
      director: 'Alex Director',
      genre: 'Action, Thriller',
      duration: 7260,
      backdrop: 'https://img.example.com/backdrops/501.jpg',
      poster: 'https://img.example.com/posters/501-big.jpg',
      year: 2019,
      rating: 7.4,
      ext: 'mkv',
      releaseDate: '2019-05-17',
    });
  });

  it('reads a film with no details (`info` is an empty array)', () => {
    expect(parseVodInfo(VOD_INFO_EMPTY)).toEqual({ name: 'Quiet Harbour', ext: 'mp4' });
    expect(parseVodInfo([])).toBeNull();
    expect(parseVodInfo({})).toBeNull();
    expect(parseVodInfo({ info: { duration: '95 min' } })).toEqual({ duration: 5700 });
  });

  it('reads seasons in order with their episodes in order, specials last', () => {
    const info = parseSeriesInfo(SERIES_INFO, 'Harbour Lights');
    expect(info?.seasons.map((s) => [s.number, s.name, s.episodes.map((e) => e.id)])).toEqual([
      [1, 'Season 1', ['9001', '9002']],
      [2, 'Season 2', ['9003']],
      [0, 'Specials', ['9100']],
    ]);
    expect(info?.seasons[0].poster).toBe('https://img.example.com/series/77-s1.jpg');
    expect(info?.seasons[0].episodes).toEqual([
      { id: '9001', season: 1, number: 1, title: 'Arrival', ext: 'mkv', duration: 2640 },
      { id: '9002', season: 1, number: 2, title: 'The Ferry', ext: 'mkv', duration: 2670 },
    ]);
    expect(info?.seasons[1].episodes[0]).toEqual({
      id: '9003',
      season: 2,
      number: 1,
      title: 'Storm Warning',
      ext: 'mp4',
      plot: 'A storm comes.',
      duration: 2700,
      still: 'https://img.example.com/ep/9003.jpg',
    });
    expect(info).toMatchObject({ name: 'Harbour Lights', year: 2018, rating: 8, backdrop: 'https://img.example.com/series/77-back.jpg' });
  });

  it('reads episodes sent as an array with no seasons', () => {
    const info = parseSeriesInfo(SERIES_INFO_FLAT, 'Night Shift');
    expect(info?.seasons.map((s) => [s.number, s.episodes.map((e) => `${e.id}:${e.title}`)])).toEqual([
      [1, ['8001:Episode 1']],
      [2, ['8002:Return']],
    ]);
    expect(parseSeriesInfo('nope')).toBeNull();
    expect(parseSeriesInfo({ episodes: {}, info: [] })).toBeNull();
  });

  it('cleans episode titles', () => {
    expect(episodeTitle('Show - S01E02 - The Title', 'Show', 1, 2)).toBe('The Title');
    expect(episodeTitle('Show.S01E02.The.Title', 'Show', 1, 2)).toBe('The.Title');
    expect(episodeTitle('Show - The Title', 'Show', 1, 2)).toBe('The Title');
    expect(episodeTitle('S1 E3', undefined, 1, 3)).toBe('Episode 3');
    expect(episodeTitle('', undefined, 1, 4)).toBe('Episode 4');
  });
});
