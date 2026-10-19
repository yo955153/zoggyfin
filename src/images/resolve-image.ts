/**
 * `resolveImage` picks the picture for any item tile.
 *
 * Rules:
 * - It only requests image types that have a tag, so it never makes a 404 request.
 * - Each image type uses its own tag (a Backdrop URL never carries a Thumb tag).
 * - When nothing is available, it returns generated art. A tile is never blank.
 */
import type { BaseItemDto } from '@/api/types';

import { type GeneratedArt, generatedArt } from './generated-art';
import {
  buildImageUrl,
  buildTrickplayUrl,
  type JellyfinImageType,
  type ServerContext,
} from './image-url';

export type ImageVariant = 'poster' | 'landscape' | 'square' | 'backdrop';

export interface ImageSize {
  /** Size of the tile in physical pixels (points times the pixel ratio). */
  width: number;
  height: number;
}

/** Shows only the first thumbnail of a trickplay sheet. */
export interface SpriteCrop {
  columns: number;
  rows: number;
}

export interface RemoteImage {
  kind: 'remote';
  uri: string;
  blurhash?: string;
  /** Which source in the chain gave the image. Useful for tests and debugging. */
  source: string;
  crop?: SpriteCrop;
}

export interface GeneratedImage extends GeneratedArt {
  kind: 'generated';
}

export type ResolvedImage = RemoteImage | GeneratedImage;

/** One candidate in a fallback chain. */
interface Candidate {
  source: string;
  itemId: string;
  type: JellyfinImageType;
  tag: string;
  index?: number;
  blurhash?: string;
}

type Step = (item: BaseItemDto) => Candidate | null;

function blurhashFor(item: BaseItemDto, type: JellyfinImageType, tag: string): string | undefined {
  const byType = item.ImageBlurHashes?.[type as keyof NonNullable<BaseItemDto['ImageBlurHashes']>];
  return byType?.[tag] ?? undefined;
}

// ---- Steps on the item itself -------------------------------------------------

const own =
  (type: 'Primary' | 'Thumb' | 'Logo' | 'Banner' | 'Art'): Step =>
  (item) => {
    const tag = item.ImageTags?.[type];
    if (!item.Id || !tag) return null;
    return { source: type, itemId: item.Id, type, tag, blurhash: blurhashFor(item, type, tag) };
  };

const ownBackdrop: Step = (item) => {
  const tag = item.BackdropImageTags?.[0];
  if (!item.Id || !tag) return null;
  return {
    source: 'Backdrop',
    itemId: item.Id,
    type: 'Backdrop',
    tag,
    index: 0,
    blurhash: blurhashFor(item, 'Backdrop', tag),
  };
};

const firstChapter: Step = (item) => {
  if (!item.Id) return null;
  const index = item.Chapters?.findIndex((c) => !!c.ImageTag) ?? -1;
  const tag = index >= 0 ? item.Chapters?.[index]?.ImageTag : null;
  if (!tag) return null;
  return { source: 'Chapter', itemId: item.Id, type: 'Chapter', tag, index };
};

// ---- Steps on a parent (series, album, artist) ---------------------------------

const seriesThumb: Step = (item) => {
  // Jellyfin fills ParentThumb* for episodes; SeriesThumbImageTag is the older field.
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return {
      source: 'SeriesThumb',
      itemId: item.ParentThumbItemId,
      type: 'Thumb',
      tag: item.ParentThumbImageTag,
      blurhash: blurhashFor(item, 'Thumb', item.ParentThumbImageTag),
    };
  }
  if (item.SeriesId && item.SeriesThumbImageTag) {
    return {
      source: 'SeriesThumb',
      itemId: item.SeriesId,
      type: 'Thumb',
      tag: item.SeriesThumbImageTag,
      blurhash: blurhashFor(item, 'Thumb', item.SeriesThumbImageTag),
    };
  }
  return null;
};

const parentBackdrop: Step = (item) => {
  const tag = item.ParentBackdropImageTags?.[0];
  if (!item.ParentBackdropItemId || !tag) return null;
  return {
    source: 'ParentBackdrop',
    itemId: item.ParentBackdropItemId,
    type: 'Backdrop',
    tag,
    index: 0,
    blurhash: blurhashFor(item, 'Backdrop', tag),
  };
};

const seriesPrimary: Step = (item) => {
  if (!item.SeriesId || !item.SeriesPrimaryImageTag) return null;
  return {
    source: 'SeriesPrimary',
    itemId: item.SeriesId,
    type: 'Primary',
    tag: item.SeriesPrimaryImageTag,
    blurhash: blurhashFor(item, 'Primary', item.SeriesPrimaryImageTag),
  };
};

const albumPrimary: Step = (item) => {
  if (!item.AlbumId || !item.AlbumPrimaryImageTag) return null;
  return {
    source: 'AlbumPrimary',
    itemId: item.AlbumId,
    type: 'Primary',
    tag: item.AlbumPrimaryImageTag,
    blurhash: blurhashFor(item, 'Primary', item.AlbumPrimaryImageTag),
  };
};

/**
 * The nearest parent with a Primary image (Jellyfin computes it). For a song
 * whose album has no art this is often the artist or the folder.
 */
const parentPrimary: Step = (item) => {
  if (!item.ParentPrimaryImageItemId || !item.ParentPrimaryImageTag) return null;
  return {
    source: 'ParentPrimary',
    itemId: item.ParentPrimaryImageItemId,
    type: 'Primary',
    tag: item.ParentPrimaryImageTag,
    blurhash: blurhashFor(item, 'Primary', item.ParentPrimaryImageTag),
  };
};

const parentThumb: Step = (item) => {
  if (!item.ParentThumbItemId || !item.ParentThumbImageTag) return null;
  return {
    source: 'ParentThumb',
    itemId: item.ParentThumbItemId,
    type: 'Thumb',
    tag: item.ParentThumbImageTag,
  };
};

// ---- Chains --------------------------------------------------------------------

const VIDEO_TYPES = new Set(['Movie', 'Video', 'Trailer', 'MusicVideo', 'Series', 'BoxSet']);
const AUDIO_TYPES = new Set(['Audio', 'AudioBook']);

/** Returns the ordered steps for an item and variant. Exported for tests. */
export function chainFor(item: BaseItemDto, variant: ImageVariant): Step[] {
  const type = item.Type ?? '';

  if (variant === 'backdrop') {
    if (type === 'Episode') {
      return [ownBackdrop, own('Primary'), parentBackdrop, seriesThumb, seriesPrimary];
    }
    if (AUDIO_TYPES.has(type)) return [own('Primary'), albumPrimary, parentPrimary, parentBackdrop];
    return [ownBackdrop, parentBackdrop, own('Thumb'), parentThumb, own('Primary'), firstChapter, seriesPrimary];
  }

  if (type === 'Episode') {
    // Spec: Primary -> series Thumb -> series Backdrop -> series Primary.
    return [own('Primary'), seriesThumb, parentBackdrop, seriesPrimary];
  }

  if (type === 'Season') {
    if (variant === 'landscape') {
      return [own('Thumb'), seriesThumb, ownBackdrop, parentBackdrop, own('Primary'), seriesPrimary];
    }
    return [own('Primary'), seriesPrimary, own('Thumb'), seriesThumb, parentBackdrop];
  }

  if (AUDIO_TYPES.has(type)) {
    // Spec: Primary -> album Primary -> artist Primary (the nearest parent with art).
    return [own('Primary'), albumPrimary, parentPrimary];
  }

  if (type === 'MusicAlbum') return [own('Primary'), parentPrimary, ownBackdrop];

  if (VIDEO_TYPES.has(type)) {
    if (variant === 'landscape') {
      // A wide tile: wide images first, the poster only after them.
      return [own('Thumb'), ownBackdrop, firstChapter, own('Primary')];
    }
    // Spec: Primary -> Thumb -> Backdrop -> first chapter image -> trickplay tile.
    return [own('Primary'), own('Thumb'), ownBackdrop, firstChapter];
  }

  // Artists, people, playlists, genres, folders and libraries.
  if (variant === 'landscape') return [own('Thumb'), ownBackdrop, own('Primary'), parentThumb, parentBackdrop];
  return [own('Primary'), own('Thumb'), ownBackdrop, parentPrimary];
}

/** The first trickplay sheet, cropped to its first thumbnail. Video items only. */
function trickplayImage(item: BaseItemDto, server: ServerContext): RemoteImage | null {
  const type = item.Type ?? '';
  if (!item.Id || !(VIDEO_TYPES.has(type) || type === 'Episode') || !item.Trickplay) return null;
  for (const [mediaSourceId, byWidth] of Object.entries(item.Trickplay)) {
    if (!byWidth) continue;
    const widths = Object.keys(byWidth)
      .map(Number)
      .filter((w) => Number.isFinite(w) && w > 0)
      .sort((a, b) => a - b);
    const width = widths[widths.length - 1];
    if (width === undefined) continue;
    const info = byWidth[String(width)];
    if (!info?.ThumbnailCount) continue;
    return {
      kind: 'remote',
      source: 'Trickplay',
      uri: buildTrickplayUrl(server, { itemId: item.Id, mediaSourceId, width, sheet: 0 }),
      crop: { columns: info.TileWidth ?? 1, rows: info.TileHeight ?? 1 },
    };
  }
  return null;
}

/**
 * The title shown on generated art. Episodes use the series name, so a run of
 * episodes without art still reads clearly.
 */
function artTitle(item: BaseItemDto): string | null | undefined {
  if (item.Type === 'Episode' && item.SeriesName) return item.SeriesName;
  return item.Name;
}

export function resolveImage(
  item: BaseItemDto,
  variant: ImageVariant,
  size: ImageSize,
  server: ServerContext | null,
): ResolvedImage {
  if (server) {
    for (const step of chainFor(item, variant)) {
      const c = step(item);
      if (!c) continue;
      return {
        kind: 'remote',
        source: c.source,
        blurhash: c.blurhash,
        uri: buildImageUrl(server, {
          itemId: c.itemId,
          type: c.type,
          tag: c.tag,
          index: c.index,
          width: size.width,
          height: size.height,
        }),
      };
    }
    const trick = trickplayImage(item, server);
    if (trick) return trick;
  }
  return { kind: 'generated', ...generatedArt(artTitle(item), item.Type, item.CollectionType) };
}
