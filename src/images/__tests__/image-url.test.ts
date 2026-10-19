import { generatedArt, iconForType } from '../generated-art';
import { bucketSize, buildImageUrl, buildTrickplayUrl, buildUserImageUrl } from '../image-url';

const server = { baseUrl: 'https://jf.example.com/base', token: 'abc' };

describe('bucketSize', () => {
  it('rounds up to a 40 px step', () => {
    expect(bucketSize(1)).toBe(40);
    expect(bucketSize(40)).toBe(40);
    expect(bucketSize(41)).toBe(80);
    expect(bucketSize(333.3)).toBe(360);
  });
  it('clamps bad and huge values', () => {
    expect(bucketSize(0)).toBe(40);
    expect(bucketSize(Number.NaN)).toBe(40);
    expect(bucketSize(99999)).toBe(3840);
  });
});

describe('buildImageUrl', () => {
  it('builds a sized, tagged URL with ApiKey', () => {
    expect(buildImageUrl(server, { itemId: 'i1', type: 'Primary', tag: 't', width: 200, height: 300 })).toBe(
      'https://jf.example.com/base/Items/i1/Images/Primary?tag=t&fillWidth=200&fillHeight=320&quality=90&ApiKey=abc',
    );
  });
  it('adds the index for backdrops and chapters only', () => {
    expect(buildImageUrl(server, { itemId: 'i', type: 'Backdrop', tag: 't', index: 2, width: 100 })).toContain(
      '/Images/Backdrop/2?',
    );
    expect(buildImageUrl(server, { itemId: 'i', type: 'Primary', tag: 't', index: 2, width: 100 })).toContain(
      '/Images/Primary?',
    );
  });
  it('omits ApiKey without a token and encodes the tag', () => {
    const url = buildImageUrl({ ...server, token: null }, { itemId: 'i', type: 'Thumb', tag: 'a b', width: 10, quality: 80 });
    expect(url).toBe('https://jf.example.com/base/Items/i/Images/Thumb?tag=a%20b&fillWidth=40&quality=80');
  });
});

describe('other URLs', () => {
  it('builds trickplay and user image URLs', () => {
    expect(buildTrickplayUrl(server, { itemId: 'v', mediaSourceId: 'm', width: 320, sheet: 0 })).toBe(
      'https://jf.example.com/base/Videos/v/Trickplay/320/0.jpg?mediaSourceId=m&ApiKey=abc',
    );
    expect(buildUserImageUrl(server, 'u', 'tg', 90)).toBe(
      'https://jf.example.com/base/Users/u/Images/Primary?tag=tg&fillWidth=120&fillHeight=120&quality=90&ApiKey=abc',
    );
  });
});

describe('generatedArt', () => {
  it('is deterministic per title', () => {
    expect(generatedArt('Sample Movie', 'Movie')).toEqual(generatedArt('Sample Movie', 'Movie'));
  });
  it('gives different titles different colors', () => {
    expect(generatedArt('Sample Movie').art.from).not.toEqual(generatedArt('Another Movie').art.from);
  });
  it('handles empty titles', () => {
    expect(generatedArt('  ').title).toBe('Untitled');
    expect(generatedArt(null).title).toBe('Untitled');
  });
  it('maps types to icons', () => {
    expect(iconForType('MusicAlbum')).toBe('music.note');
    expect(iconForType('Person')).toBe('person');
    expect(iconForType('Unknown')).toBe('play.rectangle');
    expect(iconForType('CollectionFolder', 'music')).toBe('music.note');
  });
});

describe('initials', () => {
  const { initials } = jest.requireActual<typeof import('../generated-art')>('../generated-art');
  it('takes the first letter of the first two words', () => {
    expect(initials('Jane Doe')).toBe('JD');
    expect(initials('jane')).toBe('J');
    expect(initials('www.example.net - www.sample.com')).toBe('WW');
    expect(initials('')).toBe('');
  });
});
