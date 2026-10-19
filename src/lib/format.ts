import type { BaseItemDto } from '@/api/types';

const TICKS_PER_SECOND = 10_000_000;

export function ticksToSeconds(ticks: number | null | undefined): number {
  return ticks ? ticks / TICKS_PER_SECOND : 0;
}

/** "1h 42m", "42m" or "35s". */
export function formatDuration(ticks: number | null | undefined): string | null {
  const total = Math.round(ticksToSeconds(ticks));
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

/** "3:07" or "1:02:09", for track lengths. */
export function formatClock(ticks: number | null | undefined): string | null {
  const total = Math.round(ticksToSeconds(ticks));
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "S1:E4" style label for an episode, or null. */
export function episodeLabel(item: BaseItemDto): string | null {
  const s = item.ParentIndexNumber;
  const e = item.IndexNumber;
  if (s == null && e == null) return null;
  if (s == null) return `E${e}`;
  if (e == null) return `S${s}`;
  return `S${s}:E${e}`;
}

/** Played fraction 0..1 for a progress bar, or null when there is no progress. */
export function playedFraction(item: BaseItemDto): number | null {
  const pct = item.UserData?.PlayedPercentage;
  if (typeof pct === 'number' && pct > 0 && pct < 100) return pct / 100;
  const pos = item.UserData?.PlaybackPositionTicks;
  const run = item.RunTimeTicks;
  if (pos && run && pos > 0 && pos < run) return pos / run;
  return null;
}

/** A short line under a tile title: year, series name or artist. */
export function subtitleFor(item: BaseItemDto): string | null {
  switch (item.Type) {
    case 'Episode': {
      const label = episodeLabel(item);
      return [item.SeriesName, label].filter(Boolean).join(' · ') || null;
    }
    case 'Audio':
    case 'MusicAlbum':
      return item.AlbumArtist ?? item.Artists?.[0] ?? null;
    case 'Season':
      return item.SeriesName ?? null;
    case 'Series': {
      if (!item.ProductionYear) return null;
      const end = item.EndDate ? new Date(item.EndDate).getFullYear() : null;
      if (item.Status === 'Continuing') return `${item.ProductionYear} –`;
      return end && end !== item.ProductionYear ? `${item.ProductionYear} – ${end}` : String(item.ProductionYear);
    }
    default:
      return item.ProductionYear ? String(item.ProductionYear) : null;
  }
}
