import { gridLayout, layoutFor } from '../layout';
import { fallbackArt, textDirection } from '../theme';

describe('grid layout (design system §2.3)', () => {
  it('matches the poster grid table', () => {
    expect(gridLayout('poster', 393)).toMatchObject({ columns: 3, tileWidth: 112 });
    expect(gridLayout('poster', 440)).toMatchObject({ columns: 3, tileWidth: 128 });
    expect(gridLayout('poster', 820)).toMatchObject({ columns: 5, tileWidth: 141 });
    expect(gridLayout('poster', 1180)).toMatchObject({ columns: 7, tileWidth: 145 });
  });
  it('gives square grids 2 columns and thumb grids 1 column on a phone', () => {
    expect(gridLayout('square', 393).columns).toBe(2);
    expect(gridLayout('thumb', 393).columns).toBe(1);
  });
  it('uses the content width left by a sidebar', () => {
    const l = layoutFor(1180, { sidebar: 280 });
    expect(l.contentWidth).toBe(900);
    expect(l.bp).toBe('expanded');
    expect(l.rowTile.poster).toBe(152);
  });
  it('picks row tile sizes per breakpoint', () => {
    expect(layoutFor(393).rowTile).toEqual({ poster: 116, thumb: 264, square: 148, circle: 88 });
    expect(layoutFor(393).gutter).toBe(16);
  });
});

describe('content text', () => {
  it('reads the direction from the first strong character', () => {
    expect(textDirection('رحلة إلى البحر')).toBe('rtl');
    expect(textDirection('2024 Sample')).toBe('ltr');
  });
  it('gives the same fallback art for the same title', () => {
    expect(fallbackArt('Sample Movie')).toEqual(fallbackArt('  sample movie '));
    expect(fallbackArt('Sample Movie').css).toContain('linear-gradient');
  });
});
