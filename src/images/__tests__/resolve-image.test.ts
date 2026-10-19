import type { BaseItemDto } from '@/api/types';

import { resolveImage, type RemoteImage } from '../resolve-image';

const server = { baseUrl: 'https://jf.example.com', token: 'tok123' };
const size = { width: 300, height: 450 };

function remote(item: BaseItemDto, variant: Parameters<typeof resolveImage>[1] = 'poster'): RemoteImage {
  const r = resolveImage(item, variant, size, server);
  if (r.kind !== 'remote') throw new Error(`expected remote, got generated for ${item.Name}`);
  return r;
}

describe('resolveImage – movies', () => {
  const base: BaseItemDto = { Id: 'm1', Name: 'Sample Movie', Type: 'Movie' };

  it('uses Primary first, with its tag and blurhash', () => {
    const r = remote({
      ...base,
      ImageTags: { Primary: 'p1', Thumb: 't1' },
      ImageBlurHashes: { Primary: { p1: 'LEHV6nWB2yk8' } },
    });
    expect(r.source).toBe('Primary');
    expect(r.blurhash).toBe('LEHV6nWB2yk8');
    expect(r.uri).toBe(
      'https://jf.example.com/Items/m1/Images/Primary?tag=p1&fillWidth=320&fillHeight=480&quality=90&ApiKey=tok123',
    );
  });

  it('falls back Primary -> Thumb -> Backdrop -> chapter', () => {
    expect(remote({ ...base, ImageTags: { Thumb: 't1' } }).source).toBe('Thumb');
    expect(remote({ ...base, BackdropImageTags: ['b1'] }).source).toBe('Backdrop');
    const ch = remote({ ...base, Chapters: [{ Name: 'A' }, { Name: 'B', ImageTag: 'c1' }] });
    expect(ch.source).toBe('Chapter');
    expect(ch.uri).toContain('/Items/m1/Images/Chapter/1?tag=c1');
  });

  it('uses the Backdrop tag for the Backdrop URL, never the Thumb tag', () => {
    const r = remote({ ...base, ImageTags: { Thumb: 'thumbtag' }, BackdropImageTags: ['backtag'] }, 'backdrop');
    expect(r.uri).toContain('/Images/Backdrop/0?tag=backtag');
    expect(r.uri).not.toContain('thumbtag');
  });

  it('prefers wide images for landscape tiles', () => {
    const r = remote({ ...base, ImageTags: { Primary: 'p1', Thumb: 't1' } }, 'landscape');
    expect(r.source).toBe('Thumb');
  });

  it('uses the first trickplay sheet, cropped, when nothing else exists', () => {
    const r = remote({
      ...base,
      Trickplay: { src1: { '320': { Width: 320, Height: 180, TileWidth: 10, TileHeight: 10, ThumbnailCount: 50 } } },
    });
    expect(r.source).toBe('Trickplay');
    expect(r.uri).toBe('https://jf.example.com/Videos/m1/Trickplay/320/0.jpg?mediaSourceId=src1&ApiKey=tok123');
    expect(r.crop).toEqual({ columns: 10, rows: 10 });
  });

  it('returns generated art when the item has no images', () => {
    const r = resolveImage(base, 'poster', size, server);
    expect(r.kind).toBe('generated');
    if (r.kind === 'generated') {
      expect(r.title).toBe('Sample Movie');
      expect(r.icon).toBe('film');
      expect(r.colors).toHaveLength(2);
    }
  });

  it('never requests an image type without a tag', () => {
    // Null and empty tags count as missing.
    const r = resolveImage({ ...base, ImageTags: { Primary: '' }, BackdropImageTags: [] }, 'poster', size, server);
    expect(r.kind).toBe('generated');
  });
});

describe('resolveImage – episodes', () => {
  const ep: BaseItemDto = {
    Id: 'e1',
    Name: 'Pilot',
    Type: 'Episode',
    SeriesId: 's1',
    SeriesName: 'Sample Show',
  };

  it('follows Primary -> series Thumb -> series Backdrop -> series Primary', () => {
    expect(remote({ ...ep, ImageTags: { Primary: 'p' } }).source).toBe('Primary');

    const thumb = remote({ ...ep, ParentThumbItemId: 's1', ParentThumbImageTag: 'st' });
    expect(thumb.source).toBe('SeriesThumb');
    expect(thumb.uri).toContain('/Items/s1/Images/Thumb?tag=st');

    const back = remote({ ...ep, ParentBackdropItemId: 's1', ParentBackdropImageTags: ['sb'] });
    expect(back.source).toBe('ParentBackdrop');
    expect(back.uri).toContain('/Items/s1/Images/Backdrop/0?tag=sb');

    const prim = remote({ ...ep, SeriesPrimaryImageTag: 'sp' });
    expect(prim.source).toBe('SeriesPrimary');
    expect(prim.uri).toContain('/Items/s1/Images/Primary?tag=sp');
  });

  it('accepts the older SeriesThumbImageTag field', () => {
    expect(remote({ ...ep, SeriesThumbImageTag: 'x' }).uri).toContain('/Items/s1/Images/Thumb?tag=x');
  });

  it('titles generated art with the series name', () => {
    const r = resolveImage(ep, 'landscape', size, server);
    expect(r.kind === 'generated' && r.title).toBe('Sample Show');
  });
});

describe('resolveImage – audio', () => {
  const song: BaseItemDto = { Id: 'a1', Name: 'Sample Song', Type: 'Audio' };

  it('follows Primary -> album Primary -> parent (artist) Primary', () => {
    expect(remote({ ...song, ImageTags: { Primary: 'p' } }).source).toBe('Primary');
    expect(remote({ ...song, AlbumId: 'al', AlbumPrimaryImageTag: 'ap' }).uri).toContain('/Items/al/Images/Primary?tag=ap');
    expect(remote({ ...song, ParentPrimaryImageItemId: 'ar', ParentPrimaryImageTag: 'arp' }).source).toBe(
      'ParentPrimary',
    );
  });

  it('does not use an album ID without its tag', () => {
    const r = resolveImage({ ...song, AlbumId: 'al' }, 'square', size, server);
    expect(r.kind).toBe('generated');
    expect(r.kind === 'generated' && r.icon).toBe('music.note');
  });
});

describe('resolveImage – other types', () => {
  it('uses the collection type icon for libraries', () => {
    const r = resolveImage({ Id: 'v', Name: 'Shows', Type: 'CollectionFolder', CollectionType: 'tvshows' }, 'landscape', size, server);
    expect(r.kind === 'generated' && r.icon).toBe('tv');
  });

  it('returns generated art when there is no server', () => {
    const r = resolveImage({ Id: 'p', Name: 'Jane Doe', Type: 'Person', ImageTags: { Primary: 'x' } }, 'poster', size, null);
    expect(r.kind).toBe('generated');
  });

  it('uses season poster, then series poster', () => {
    const season: BaseItemDto = { Id: 'se', Name: 'Season 1', Type: 'Season', SeriesId: 's1' };
    expect(remote({ ...season, SeriesPrimaryImageTag: 'sp' }).source).toBe('SeriesPrimary');
    expect(remote({ ...season, ImageTags: { Primary: 'p' }, SeriesPrimaryImageTag: 'sp' }).source).toBe('Primary');
  });
});
