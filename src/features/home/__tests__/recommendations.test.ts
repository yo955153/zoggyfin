import type { RecommendationDto } from '@/api/types';

import { item } from '../test-utils/items';
import { recommendationRows, recommendationTitle } from '../recommendations';

describe('recommendation titles', () => {
  it('names each kind of category', () => {
    expect(recommendationTitle('SimilarToRecentlyPlayed', 'Heat')).toBe('Because you watched Heat');
    expect(recommendationTitle('SimilarToLikedItem', 'Heat')).toBe('Because you liked Heat');
    expect(recommendationTitle('HasDirectorFromRecentlyPlayed', 'Jane Doe')).toBe('Directed by Jane Doe');
    expect(recommendationTitle('HasLikedDirector', 'Jane Doe')).toBe('Directed by Jane Doe');
    expect(recommendationTitle('HasActorFromRecentlyPlayed', 'Sam Roe')).toBe('Starring Sam Roe');
    expect(recommendationTitle('HasLikedActor', 'Sam Roe')).toBe('Starring Sam Roe');
  });

  it('falls back for a type it does not know', () => {
    expect(recommendationTitle('SomethingNew', 'Heat')).toBe('More like Heat');
    expect(recommendationTitle(undefined, 'Heat')).toBe('More like Heat');
  });

  it('gives no title without a baseline name', () => {
    expect(recommendationTitle('SimilarToRecentlyPlayed', null)).toBeNull();
    expect(recommendationTitle('SimilarToRecentlyPlayed', '   ')).toBeNull();
  });
});

describe('recommendation rows', () => {
  const cat = (over: Partial<RecommendationDto>): RecommendationDto => ({
    RecommendationType: 'SimilarToRecentlyPlayed',
    BaselineItemName: 'Heat',
    CategoryId: 'c1',
    Items: [{ Id: 'a', Name: 'A' }],
    ...over,
  });

  it('drops items the user has played or started', () => {
    const rows = recommendationRows([
      cat({
        Items: [
          item('a', {}, { Played: true }),
          item('b', {}, { PlaybackPositionTicks: 5 }),
          item('c', {}, { Played: false }),
          item('d'),
        ],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].items.map((i) => i.Id)).toEqual(['c', 'd']);
  });

  it('drops empty, nameless and repeated categories', () => {
    const rows = recommendationRows([
      cat({ CategoryId: 'x', Items: [] }),
      cat({ CategoryId: 'y', BaselineItemName: null }),
      cat({ CategoryId: 'z', Items: [item('a', {}, { Played: true })] }),
      cat({ CategoryId: 'c1' }),
      cat({ CategoryId: 'c2' }),
      cat({ CategoryId: 'c3', RecommendationType: 'HasLikedActor', BaselineItemName: 'Sam Roe' }),
    ]);
    expect(rows.map((r) => [r.key, r.title])).toEqual([
      ['c1', 'Because you watched Heat'],
      ['c3', 'Starring Sam Roe'],
    ]);
  });

  it('keeps the server order and stops at the maximum', () => {
    const many = ['A', 'B', 'C', 'D'].map((n) => cat({ CategoryId: n, BaselineItemName: n }));
    expect(recommendationRows(many).map((r) => r.key)).toEqual(['A', 'B', 'C']);
    expect(recommendationRows(many, 2).map((r) => r.key)).toEqual(['A', 'B']);
  });

  it('gives nothing for no answer', () => {
    expect(recommendationRows(undefined)).toEqual([]);
    expect(recommendationRows([])).toEqual([]);
  });
});
