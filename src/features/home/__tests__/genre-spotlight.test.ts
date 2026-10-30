import { daySeed } from '../daily';
import { genreSize, pickDailyGenre, spotlightItems, spotlightTitle } from '../genre-spotlight';
import { item } from '../test-utils/items';

const genre = (id: string, movies?: number, series?: number, child?: number) =>
  item(id, { Name: `Genre ${id}`, Type: 'Genre', MovieCount: movies, SeriesCount: series, ChildCount: child });

describe('genre size', () => {
  it('adds movies and shows', () => {
    expect(genreSize(genre('a', 3, 2, 40))).toBe(5);
    expect(genreSize(genre('a', 3, undefined, 40))).toBe(3);
  });

  it('falls back to the child count without item counts', () => {
    expect(genreSize(genre('a', undefined, undefined, 7))).toBe(7);
    expect(genreSize(genre('a'))).toBe(0);
  });
});

describe('daily genre pick', () => {
  const genres = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id) => genre(id, 10));

  it('gives the same genre all day for one user', () => {
    const seed = daySeed('2026-10-30', 'user1');
    const pick = pickDailyGenre(genres, seed);
    expect(pick).not.toBeNull();
    expect(pickDailyGenre(genres, seed)?.Id).toBe(pick?.Id);
  });

  it('does not depend on the server order', () => {
    const seed = daySeed('2026-10-30', 'user1');
    expect(pickDailyGenre([...genres].reverse(), seed)?.Id).toBe(pickDailyGenre(genres, seed)?.Id);
  });

  it('moves to other genres over the days', () => {
    const picks = new Set(
      Array.from({ length: 30 }, (_, d) => pickDailyGenre(genres, daySeed(`2026-11-${String(d + 1).padStart(2, '0')}`, 'user1'))?.Id),
    );
    expect(picks.size).toBeGreaterThan(2);
  });

  it('skips small and nameless genres', () => {
    const list = [genre('small', 2, 1), item('noname', { Name: ' ', MovieCount: 50 }), genre('big', 3, 1)];
    for (const day of ['2026-10-30', '2026-10-31', '2026-11-01']) {
      expect(pickDailyGenre(list, daySeed(day, 'u'))?.Id).toBe('big');
    }
  });

  it('gives null when no genre is big enough', () => {
    expect(pickDailyGenre([genre('a', 1)], 'x')).toBeNull();
    expect(pickDailyGenre(undefined, 'x')).toBeNull();
  });
});

describe('spotlight row', () => {
  it('titles the row with the genre', () => {
    expect(spotlightTitle(genre('a'))).toBe('Genre of the day: Genre a');
  });

  it('puts unwatched items first and keeps the server order in each part', () => {
    const items = [
      item('w1', {}, { Played: true }),
      item('u1'),
      item('w2', {}, { Played: true }),
      item('u2', {}, { Played: false }),
      { Name: 'no id' },
    ];
    expect(spotlightItems(items).map((i) => i.Id)).toEqual(['u1', 'u2', 'w1', 'w2']);
    expect(spotlightItems(items, 3).map((i) => i.Id)).toEqual(['u1', 'u2', 'w1']);
  });
});
