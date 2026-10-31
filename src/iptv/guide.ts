/**
 * Guide rules: now and next for a channel, and merging programmes into a
 * window. The window shape (`GuideWindow`) is what phase 2's grid guide
 * reads too; phase 1 fills it from Xtream `get_short_epg` or from a small
 * XMLTV window. Pure, so it is unit-tested.
 */
import type { Channel, GuideWindow, NowNext, Programme } from './types';
import { GUIDE_SCHEMA_VERSION } from './types';

export const EMPTY_GUIDE: GuideWindow = { schemaVersion: GUIDE_SCHEMA_VERSION, from: 0, to: 0, channels: {} };

/** The programme that runs at `at` and the one after it. */
export function nowNext(programmes: readonly Programme[] | undefined, at: number): NowNext {
  if (!programmes?.length) return { now: null, next: null };
  let now: Programme | null = null;
  let next: Programme | null = null;
  for (const p of programmes) {
    if (p.start <= at && p.stop > at) now = p;
    else if (p.start > at && (!next || p.start < next.start)) next = p;
  }
  return { now, next };
}

/** How far into the programme `at` is, 0..1. */
export function progressOf(p: Programme, at: number): number {
  if (p.stop <= p.start) return 0;
  return Math.min(1, Math.max(0, (at - p.start) / (p.stop - p.start)));
}

/** The guide id for a channel: its own, or the XMLTV channel with the same display name. */
export function guideIdFor(channel: Channel, names: ReadonlyMap<string, string> | null): string | null {
  if (channel.epgId) return channel.epgId;
  return names?.get(channel.name.trim().toLowerCase()) ?? null;
}

/** Sets a channel's programmes in the window (a new object; the old one is unchanged). */
export function withProgrammes(guide: GuideWindow, id: string, programmes: Programme[]): GuideWindow {
  const from = programmes.length ? Math.min(guide.from || Infinity, programmes[0].start) : guide.from;
  const to = programmes.length ? Math.max(guide.to, programmes[programmes.length - 1].stop) : guide.to;
  return { ...guide, from: Number.isFinite(from) ? from : 0, to, channels: { ...guide.channels, [id]: programmes } };
}

/** True when the window has nothing for `at` any more for a channel that had programmes (time to load again). */
export function isStale(guide: GuideWindow, id: string, at: number): boolean {
  const list = guide.channels[id];
  if (!list) return true;
  if (!list.length) return false;
  return !list.some((p) => p.stop > at);
}
