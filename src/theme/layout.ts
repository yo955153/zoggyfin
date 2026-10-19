/**
 * Layout from the window or content width (design system §2). Pure: no React,
 * so it is unit-tested. TV gets its own 10-foot sizes (§ TV in the spec).
 */
import { type Breakpoint, breakpointFor, gridFor, type GridResult, layout, type TileKind } from './theme';

/**
 * TV sizes, designed on a 1920-point-wide screen (Apple TV). Android TV
 * reports 960 dp, so every value is scaled by `width / 1920`.
 */
export const tv = {
  baseWidth: 1920,
  railWidth: 300,
  gutter: 80,
  tileGap: 36,
  sectionGap: 56,
  rowTileWidth: { poster: 248, thumb: 520, square: 300, circle: 180 } satisfies Record<TileKind, number>,
  gridMinTile: { poster: 236, thumb: 480, square: 280, circle: 190 } satisfies Record<TileKind, number>,
  /** Type sizes are the phone sizes times this (before the screen scale). */
  typeScale: 1.6,
  /** The focused tile grows by this much, as on tvOS. */
  focusScale: 1.08,
  focusRingWidth: 4,
  focusRingGap: 4,
  railItemHeight: 64,
  railIcon: 30,
} as const;

export function tvScale(width: number): number {
  return Math.max(0.5, width / tv.baseWidth);
}

export interface LayoutInfo {
  tv: boolean;
  bp: Breakpoint;
  /** Width the screen content gets (the window minus a sidebar or rail). */
  contentWidth: number;
  gutter: number;
  gap: number;
  /** Vertical gap between Home rows. */
  sectionGap: number;
  /** Tile width in a horizontal row. */
  rowTile: Record<TileKind, number>;
}

/**
 * Layout for a window. `sidebar` is the width of a visible sidebar (iPad) or
 * the TV rail; grids and rows use the width that is left.
 */
export function layoutFor(width: number, opts: { tv?: boolean; sidebar?: number } = {}): LayoutInfo {
  if (opts.tv) {
    const s = tvScale(width);
    const rail = (opts.sidebar ?? tv.railWidth) * s;
    const r = (k: TileKind) => Math.round(tv.rowTileWidth[k] * s);
    return {
      tv: true,
      bp: 'wide',
      contentWidth: Math.max(0, width - rail),
      gutter: Math.round(tv.gutter * s),
      gap: Math.round(tv.tileGap * s),
      sectionGap: Math.round(tv.sectionGap * s),
      rowTile: { poster: r('poster'), thumb: r('thumb'), square: r('square'), circle: r('circle') },
    };
  }
  const contentWidth = Math.max(0, width - (opts.sidebar ?? 0));
  const bp = breakpointFor(contentWidth);
  return {
    tv: false,
    bp,
    contentWidth,
    gutter: layout.gutter[bp],
    gap: layout.tileGap[bp],
    sectionGap: 28,
    rowTile: {
      poster: layout.rowTileWidth.poster[bp],
      thumb: layout.rowTileWidth.thumb[bp],
      square: layout.rowTileWidth.square[bp],
      circle: layout.rowTileWidth.circle[bp],
    },
  };
}

/** Grid columns and tile width for a content width. TV uses the 10-foot minimum tile widths. */
export function gridLayout(kind: TileKind, contentWidth: number, isTv = false, screenWidth = contentWidth): GridResult {
  if (!isTv) return gridFor(kind, contentWidth);
  const s = tvScale(screenWidth);
  const gutter = Math.round(tv.gutter * s);
  const gap = Math.round(tv.tileGap * s);
  const min = tv.gridMinTile[kind] * s;
  const [lo, hi] = layout.gridColumnLimits[kind];
  const inner = contentWidth - gutter * 2;
  const columns = Math.min(hi, Math.max(lo, Math.floor((inner + gap) / (min + gap))));
  const tileWidth = Math.floor((inner - gap * (columns - 1)) / columns);
  return { columns, tileWidth, gap, gutter };
}
