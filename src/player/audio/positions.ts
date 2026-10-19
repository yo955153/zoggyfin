/**
 * Local resume positions for long-form audio. The server keeps positions
 * for audiobooks but not for plain audio tracks (a recitation in a music
 * library), so the app keeps its own, and the larger of the two wins.
 */
import type { KeyValueStore } from '@/storage/kv-types';

export interface SavedPosition {
  seconds: number;
  duration: number;
  at: number;
}

const KEY = 'audio.positions';
export const MAX_POSITIONS = 400;
/** Closer than this to the end counts as finished: the next play starts at 0. */
export const FINISHED_TAIL_SECONDS = 30;
/** Earlier than this is not worth resuming. */
export const MIN_RESUME_SECONDS = 10;

type Map_ = Record<string, SavedPosition>;

export class PositionStore {
  private cache: Map_ | null = null;

  constructor(private readonly kv: KeyValueStore) {}

  private all(): Map_ {
    if (this.cache) return this.cache;
    try {
      const raw = this.kv.getString(KEY);
      this.cache = raw ? (JSON.parse(raw) as Map_) : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private write(map: Map_): void {
    this.cache = map;
    this.kv.set(KEY, JSON.stringify(map));
  }

  get(itemId: string): SavedPosition | null {
    return this.all()[itemId] ?? null;
  }

  /** Saves a position; a finished item (or one barely started) is forgotten. */
  save(itemId: string, seconds: number, duration: number, now = Date.now()): void {
    const map = { ...this.all() };
    if (seconds < MIN_RESUME_SECONDS || (duration > 0 && seconds >= duration - FINISHED_TAIL_SECONDS)) {
      if (!(itemId in map)) return;
      delete map[itemId];
    } else {
      map[itemId] = { seconds, duration, at: now };
    }
    const keys = Object.keys(map);
    if (keys.length > MAX_POSITIONS) {
      keys
        .sort((a, b) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0))
        .slice(0, keys.length - MAX_POSITIONS)
        .forEach((k) => delete map[k]);
    }
    this.write(map);
  }

  forget(itemId: string): void {
    const map = { ...this.all() };
    if (!(itemId in map)) return;
    delete map[itemId];
    this.write(map);
  }
}

/**
 * Where to resume: the later of the local and the server position, unless
 * the item is (nearly) finished. Seconds; 0 starts at the beginning.
 */
export function resumeSeconds(local: SavedPosition | null, serverSeconds: number, duration: number): number {
  const s = Math.max(local?.seconds ?? 0, serverSeconds);
  if (s < MIN_RESUME_SECONDS) return 0;
  if (duration > 0 && s >= duration - FINISHED_TAIL_SECONDS) return 0;
  return s;
}
