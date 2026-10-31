import { episodeLine, factsOf, ratingText, runtimeText, tileOfItem, tileOfPosition } from '../vod-view';

describe('film and series page text', () => {
  it('writes runtimes and ratings', () => {
    expect(runtimeText(7260)).toBe('2 h 1 min');
    expect(runtimeText(7200)).toBe('2 h');
    expect(runtimeText(2700)).toBe('45 min');
    expect(runtimeText(30)).toBeNull();
    expect(runtimeText(undefined)).toBeNull();
    expect(ratingText(7)).toBe('★ 7');
    expect(ratingText(7.45)).toBe('★ 7.5');
    expect(ratingText(undefined)).toBeNull();
  });

  it('builds the facts line from the details first, then the catalogue entry', () => {
    expect(factsOf('film', { year: 2019, rating: 7 }, { genre: 'Drama', duration: 5400, rating: 7.4 })).toEqual(['2019', 'Drama', '1 h 30 min', '★ 7.4']);
    expect(factsOf('film', null, null)).toEqual([]);
    const seasons = [
      { number: 1, name: 'Season 1', episodes: [] },
      { number: 0, name: 'Specials', episodes: [] },
    ];
    expect(factsOf('series', { year: 2018 }, { seasons })).toEqual(['2018', '1 season']);
  });

  it('makes tiles for titles and Continue watching', () => {
    expect(tileOfItem('film', { id: '1', name: 'A', categoryId: '', year: 2001, rating: 8 })).toEqual({
      key: 'film:1',
      id: '1',
      kind: 'film',
      title: 'A',
      subtitle: '2001 · ★ 8',
      poster: null,
      progress: null,
    });
    expect(tileOfPosition({ kind: 'episode', id: 'e', seriesId: 's', seriesName: 'Show', season: 1, episode: 2, title: 'Two', position: 600, duration: 2400, at: 1, finished: false })).toMatchObject({
      kind: 'episode',
      title: 'Show',
      subtitle: 'S1 E2 · 30 min left',
      progress: 0.25,
    });
    expect(episodeLine({ id: 'e', season: 2, number: 3, title: 'x', duration: 2640 })).toBe('S2 E3 · 44 min');
  });
});
