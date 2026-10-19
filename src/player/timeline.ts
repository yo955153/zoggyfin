/**
 * Scrubber helpers: trickplay tiles and chapter marks. Pure.
 */
import type { ChapterInfo, TrickplayInfoDto } from '@/api/types';

import { withStreamAuth } from './stream';

export interface Trickplay {
  /** Thumbnail width in pixels: the key in the server's Trickplay map. */
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  count: number;
  /** Milliseconds between thumbnails. */
  interval: number;
}

type TrickplayMap = Record<string, Record<string, TrickplayInfoDto> | null> | null | undefined;

/** The trickplay set for a media source, closest to `preferred` pixels wide. */
export function pickTrickplay(map: TrickplayMap, mediaSourceId: string, preferred = 320): Trickplay | null {
  const sets = map?.[mediaSourceId] ?? (map ? Object.values(map)[0] : undefined);
  if (!sets) return null;
  const options = Object.values(sets)
    .filter((t) => t.Width && t.Height && t.TileWidth && t.TileHeight && t.ThumbnailCount && t.Interval)
    .map((t) => ({
      width: t.Width as number,
      height: t.Height as number,
      tileWidth: t.TileWidth as number,
      tileHeight: t.TileHeight as number,
      count: t.ThumbnailCount as number,
      interval: t.Interval as number,
    }));
  if (!options.length) return null;
  return options.reduce((best, t) => (Math.abs(t.width - preferred) < Math.abs(best.width - preferred) ? t : best));
}

export interface TrickplayTile {
  /** Which sprite sheet image. */
  sheet: number;
  /** Offset of the thumbnail inside the sheet, in sheet pixels. */
  x: number;
  y: number;
}

export function trickplayTile(t: Trickplay, seconds: number): TrickplayTile {
  const index = Math.min(t.count - 1, Math.max(0, Math.floor((seconds * 1000) / t.interval)));
  const perSheet = t.tileWidth * t.tileHeight;
  const sheet = Math.floor(index / perSheet);
  const local = index % perSheet;
  return { sheet, x: (local % t.tileWidth) * t.width, y: Math.floor(local / t.tileWidth) * t.height };
}

export function trickplaySheetUrl(
  server: { baseUrl: string; token: string | null },
  itemId: string,
  mediaSourceId: string,
  t: Trickplay,
  sheet: number,
): string {
  const base = server.baseUrl.replace(/\/+$/, '');
  return withStreamAuth(`${base}/Videos/${itemId}/Trickplay/${t.width}/${sheet}.jpg?MediaSourceId=${mediaSourceId}`, server.token);
}

export interface Chapter {
  name: string;
  start: number;
}

export function chaptersOf(raw: readonly ChapterInfo[] | null | undefined, duration: number): Chapter[] {
  return (raw ?? [])
    .map((c, i) => ({ name: c.Name || `Chapter ${i + 1}`, start: (c.StartPositionTicks ?? 0) / 1e7 }))
    .filter((c) => c.start >= 0 && (duration <= 0 || c.start < duration))
    .sort((a, b) => a.start - b.start);
}

/** The chapter that contains `seconds`, or null before the first. */
export function chapterAt(chapters: readonly Chapter[], seconds: number): Chapter | null {
  let found: Chapter | null = null;
  for (const c of chapters) {
    if (c.start <= seconds) found = c;
    else break;
  }
  return found;
}

/** Chapter marks as fractions of the track; a mark at 0 is left out. */
export function chapterMarks(chapters: readonly Chapter[], duration: number): number[] {
  if (!(duration > 0)) return [];
  return chapters.map((c) => c.start / duration).filter((f) => f > 0.005 && f < 0.995);
}

/** "1:02:03" or "4:05". Negative values get a leading minus (remaining time). */
export function formatTime(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.floor(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return neg ? `−${body}` : body;
}

/** VoiceOver text: "1 minute 34 seconds". */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return [h ? part(h, 'hour') : null, m ? part(m, 'minute') : null, part(sec, 'second')].filter(Boolean).join(' ');
}
