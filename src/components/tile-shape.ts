import type { BaseItemDto } from '@/api/types';
import type { ImageVariant } from '@/images/resolve-image';

/** The design system tile kinds (§7.3). `thumb` is 16:9. */
export type TileShape = 'poster' | 'thumb' | 'square' | 'circle';

export const SHAPES: Record<TileShape, { variant: ImageVariant; aspect: number }> = {
  poster: { variant: 'poster', aspect: 2 / 3 },
  thumb: { variant: 'landscape', aspect: 16 / 9 },
  square: { variant: 'square', aspect: 1 },
  circle: { variant: 'square', aspect: 1 },
};

/** The best tile shape for an item type. */
export function shapeFor(item: BaseItemDto): TileShape {
  switch (item.Type) {
    case 'Episode':
    case 'Video':
    case 'MusicVideo':
    case 'CollectionFolder':
    case 'UserView':
      return 'thumb';
    case 'MusicAlbum':
    case 'Audio':
    case 'Playlist':
    case 'MusicGenre':
    case 'Genre':
      return 'square';
    case 'MusicArtist':
    case 'Person':
      return 'circle';
    default:
      return 'poster';
  }
}

/**
 * Picks poster or thumb (16:9) tiles for a list from the images it really has:
 * a library of wide thumbnails (for example home videos filed as movies)
 * gets wide tiles instead of cropped posters.
 */
export function shapeForList(items: readonly BaseItemDto[] | undefined, fallback: TileShape): TileShape {
  if (!items?.length || (fallback !== 'poster' && fallback !== 'thumb')) return fallback;
  const ratios = items.map((i) => i.PrimaryImageAspectRatio).filter((r): r is number => typeof r === 'number' && r > 0);
  if (ratios.length < Math.ceil(items.length / 2)) return fallback;
  const wide = ratios.filter((r) => r > 1.2).length;
  return wide > ratios.length / 2 ? 'thumb' : 'poster';
}
