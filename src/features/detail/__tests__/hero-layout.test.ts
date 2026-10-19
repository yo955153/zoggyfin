import { heroHeight, heroLayout } from '../hero-layout';

describe('heroLayout', () => {
  it('uses the wide hero for a video with only a wide primary image', () => {
    expect(heroLayout({ Type: 'Video', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 1.78 })).toBe('wide');
    expect(heroLayout({ Type: 'Movie', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 1.78 })).toBe('wide');
  });
  it('keeps the tall backdrop when the item has a backdrop', () => {
    expect(heroLayout({ Type: 'Movie', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 0.67, BackdropImageTags: ['b'] })).toBe('backdrop');
    expect(heroLayout({ Type: 'Series', BackdropImageTags: ['b'] })).toBe('backdrop');
  });
  it('uses the tall hero for a portrait poster alone', () => {
    expect(heroLayout({ Type: 'Movie', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 0.67 })).toBe('backdrop');
  });
  it('uses the wide hero for thumbs, episodes and image-less videos', () => {
    expect(heroLayout({ Type: 'Movie', ImageTags: { Thumb: 't' } })).toBe('wide');
    expect(heroLayout({ Type: 'Episode', ImageTags: { Primary: 'p' } })).toBe('wide');
    expect(heroLayout({ Type: 'Video' })).toBe('wide');
  });
  it('uses square and circle art for music and people', () => {
    expect(heroLayout({ Type: 'MusicAlbum' })).toBe('square');
    expect(heroLayout({ Type: 'Playlist' })).toBe('square');
    expect(heroLayout({ Type: 'MusicArtist' })).toBe('circle');
    expect(heroLayout({ Type: 'Person' })).toBe('circle');
  });
  it('sizes the hero', () => {
    expect(heroHeight('backdrop', 393, 852, false)).toBe(477);
    expect(heroHeight('backdrop', 393, 1000, false)).toBe(520);
    expect(heroHeight('wide', 393, 852, false)).toBe(221);
    expect(heroHeight('square', 393, 852, false)).toBe(0);
  });
});
