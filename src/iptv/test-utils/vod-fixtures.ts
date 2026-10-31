/**
 * Xtream film and series answers in the shapes panels really send: numbers as
 * strings, empty strings and nulls, `info` as [] when missing, ratings as
 * text, `added` as epoch seconds in a string, backdrops as arrays. Made-up
 * titles and example.com addresses only.
 */

export const VOD_CATEGORIES = [
  { category_id: '10', category_name: 'Action', parent_id: 0 },
  { category_id: 11, category_name: 'Drama' },
  { category_id: '10', category_name: 'Action (again)' },
  { category_id: '', category_name: 'No id' },
  { category_id: '12', category_name: '' },
  null,
];

export const VOD_STREAMS = [
  {
    num: 1,
    name: 'The Long Night (2019)',
    stream_type: 'movie',
    stream_id: '501',
    stream_icon: 'https://img.example.com/posters/501.jpg',
    rating: '7.4',
    rating_5based: 3.7,
    added: '1690000000',
    category_id: '10',
    container_extension: 'mkv',
    custom_sid: null,
    direct_source: '',
    tmdb: '12345',
  },
  {
    num: 2,
    name: 'Quiet Harbour',
    stream_type: 'movie',
    stream_id: 502,
    stream_icon: '',
    rating: '',
    rating_5based: '4.5',
    added: 1700000000,
    category_id: 11,
    container_extension: 'MP4',
    year: '2021',
  },
  { num: 3, name: 'Broken Entry', stream_id: null, category_id: '10' },
  { num: 4, name: 'Duplicate', stream_id: '501', category_id: '10' },
  {
    num: 5,
    name: 'Sea of Glass - 2015',
    stream_id: '503',
    stream_icon: null,
    rating: 0,
    rating_5based: 0,
    added: '',
    category_id: '10',
    container_extension: '',
    tmdb: 0,
  },
];

export const VOD_INFO = {
  info: {
    movie_image: 'https://img.example.com/posters/501-big.jpg',
    tmdb_id: '12345',
    backdrop_path: ['https://img.example.com/backdrops/501.jpg'],
    youtube_trailer: '',
    genre: 'Action, Thriller',
    plot: 'A night  watchman\n finds out what the night hides.',
    cast: 'Jane Doe, Sam Example',
    rating: '7.4',
    director: 'Alex Director',
    releasedate: '2019-05-17',
    duration_secs: 7260,
    duration: '02:01:00',
    video: {},
    audio: {},
    bitrate: 0,
  },
  movie_data: { stream_id: 501, name: 'The Long Night (2019)', added: '1690000000', category_id: '10', container_extension: 'mkv', custom_sid: '', direct_source: '' },
};

/** A panel with no details for a film. */
export const VOD_INFO_EMPTY = { info: [], movie_data: { stream_id: '502', name: 'Quiet Harbour', container_extension: 'mp4' } };

export const SERIES_LIST = [
  {
    num: 1,
    name: 'Harbour Lights',
    series_id: 77,
    cover: 'https://img.example.com/series/77.jpg',
    plot: 'Life in a small port town.',
    cast: 'Jane Doe',
    director: '',
    genre: 'Drama',
    releaseDate: '2018-01-20',
    last_modified: '1695000000',
    rating: '8',
    rating_5based: 4,
    backdrop_path: [],
    youtube_trailer: null,
    episode_run_time: '45',
    category_id: '20',
  },
  { num: 2, name: 'Night Shift (2020)', series_id: '78', cover: null, rating: null, category_id: 21, last_modified: '0' },
  { num: 3, name: 'No Id' },
];

export const SERIES_INFO = {
  seasons: [
    { air_date: '2018-01-20', episode_count: 2, id: 1, name: 'Season 1', overview: '', season_number: 1, cover: 'https://img.example.com/series/77-s1.jpg', cover_big: '' },
    { air_date: '', episode_count: 1, id: 2, name: 'Season 2', season_number: '2', cover: null },
  ],
  info: {
    name: 'Harbour Lights',
    cover: 'https://img.example.com/series/77.jpg',
    plot: 'Life in a small port town.',
    cast: 'Jane Doe',
    genre: 'Drama',
    releaseDate: '2018-01-20',
    rating: '8.0',
    backdrop_path: ['https://img.example.com/series/77-back.jpg'],
    category_id: '20',
  },
  episodes: {
    '2': [
      {
        id: '9003',
        episode_num: '1',
        title: 'Harbour Lights - S02E01 - Storm Warning',
        container_extension: 'mp4',
        info: { movie_image: 'https://img.example.com/ep/9003.jpg', plot: 'A storm comes.', duration_secs: '2700', name: '' },
        season: 2,
      },
    ],
    '1': [
      { id: '9002', episode_num: 2, title: 'Harbour Lights - S01E02 - The Ferry', container_extension: 'mkv', info: { duration: '00:44:30' }, season: '1' },
      { id: '9001', episode_num: 1, title: 'Harbour Lights - S01E01 - Arrival', container_extension: 'mkv', info: { name: 'Arrival', duration_secs: 2640 }, season: 1 },
    ],
    '0': [{ id: '9100', episode_num: 1, title: 'Behind the Scenes', container_extension: 'mp4', info: [], season: 0 }],
  },
};

/** A panel that sends episodes as a flat array and no seasons. */
export const SERIES_INFO_FLAT = {
  seasons: [],
  info: { name: 'Night Shift' },
  episodes: [
    [{ id: 8001, episode_num: 1, title: 'Night Shift S01E01', container_extension: 'mp4', season: 1 }],
    [{ id: 8002, episode_num: 1, title: 'S02E01 - Return', container_extension: 'mp4', season: 2 }],
  ],
};

/** An M3U list with live channels, films and episodes. */
export const VOD_M3U = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="news.example" group-title="News",Example News',
  'http://panel.example.com/jane/secret/1001',
  '#EXTINF:-1 tvg-logo="https://img.example.com/f1.jpg" group-title="Films | Action",The Long Night (2019)',
  'http://panel.example.com/movie/jane/secret/501.mkv',
  '#EXTINF:-1 group-title="Films | Drama",Quiet Harbour',
  'https://cdn.example.com/vod/quiet-harbour.mp4?token=abc',
  '#EXTINF:-1 tvg-logo="https://img.example.com/s77.jpg" group-title="Series | Drama",Harbour Lights S01 E02',
  'http://panel.example.com/series/jane/secret/9002.mkv',
  '#EXTINF:-1 tvg-logo="https://img.example.com/s77.jpg" group-title="Series | Drama",Harbour Lights S01 E01',
  'http://panel.example.com/series/jane/secret/9001.mkv',
  '#EXTINF:-1 group-title="Series | Drama",Unnumbered Special',
  'http://panel.example.com/series/jane/secret/9100.mp4',
  '#EXTINF:-1 group-title="Music",Radio Example',
  'http://stream.example.com/radio.ts',
  '',
].join('\n');
