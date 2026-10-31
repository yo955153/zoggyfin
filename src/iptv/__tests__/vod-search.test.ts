import { buildTitleIndex, searchTitles, titleScore } from '../vod-search';

const titles = [
  { name: 'The Dark Knight', rating: 9, year: 2008 },
  { name: 'Dark', rating: 8.7, year: 2017 },
  { name: 'Knight and Day', rating: 6.3, year: 2010 },
  { name: 'Darkness Falls', rating: 5, year: 2003 },
  { name: 'The Midnight Sky', rating: 5.6, year: 2020 },
  { name: 'Dark Waters', rating: 7.6, year: 2019 },
  { name: 'Amélie', rating: 8.3, year: 2001 },
];

describe('film and series title search', () => {
  const index = buildTitleIndex(titles);

  it('ranks the exact title, then titles that start with the query, then word starts', () => {
    expect(searchTitles(index, 'dark').map((t) => t.name)).toEqual(['Dark', 'Dark Waters', 'Darkness Falls', 'The Dark Knight']);
  });

  it('needs every word, at word starts or inside words (inside ranks last)', () => {
    expect(searchTitles(index, 'dark kni').map((t) => t.name)).toEqual(['The Dark Knight']);
    expect(searchTitles(index, 'night').map((t) => t.name)).toEqual(['The Dark Knight', 'Knight and Day', 'The Midnight Sky']);
    expect(searchTitles(index, 'zzz')).toEqual([]);
    expect(searchTitles(index, '  ')).toEqual([]);
  });

  it('ignores case, accents and punctuation', () => {
    expect(searchTitles(index, 'AMELIE').map((t) => t.name)).toEqual(['Amélie']);
    expect(searchTitles(index, 'dark-waters').map((t) => t.name)).toEqual(['Dark Waters']);
  });

  it('breaks ties by rating, then year', () => {
    const same = buildTitleIndex([
      { name: 'Alpha One', rating: 5, year: 2000 },
      { name: 'Alpha Two', rating: 7, year: 1990 },
      { name: 'Alpha Three', rating: 7, year: 2010 },
      { name: 'Alpha Four' },
    ]);
    expect(searchTitles(same, 'alpha').map((t) => t.name)).toEqual(['Alpha Three', 'Alpha Two', 'Alpha One', 'Alpha Four']);
    expect(searchTitles(same, 'alpha', 2)).toHaveLength(2);
  });

  it('scores', () => {
    expect(titleScore('dark', ['dark'], 'dark')).toBe(4);
    expect(titleScore('dark waters', ['dark'], 'dark')).toBe(3);
    expect(titleScore('the dark knight', ['dark'], 'dark')).toBe(2);
    expect(titleScore('the midnight sky', ['night'], 'night')).toBe(1);
    expect(titleScore('sky', ['night'], 'night')).toBe(0);
  });

  it('searches 20 000 titles quickly', () => {
    const big = buildTitleIndex(Array.from({ length: 20_000 }, (_, i) => ({ name: `Film number ${i} of the example catalogue` })));
    const t = Date.now();
    const hits = searchTitles(big, 'number 1999');
    expect(Date.now() - t).toBeLessThan(500);
    expect(hits[0].name).toBe('Film number 1999 of the example catalogue');
  });
});
