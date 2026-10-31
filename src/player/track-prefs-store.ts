/**
 * Saves the IPTV track choices (`track-prefs.ts`) on the device, one record
 * per account: the providers belong to an account, and so do the choices.
 */
import { useSessionStore } from '@/auth/session-store';
import { readJson, writeJson } from '@/storage/json';

import { EMPTY_TRACK_PREFS, migrateTrackPrefs, type TrackPrefs } from './track-prefs';

function key(): string | null {
  const s = useSessionStore.getState().session;
  return s ? `player.iptvTracks.${s.serverId}.${s.userId}` : null;
}

let cache: { key: string; prefs: TrackPrefs } | null = null;

export function loadTrackPrefs(): TrackPrefs {
  const k = key();
  if (!k) return EMPTY_TRACK_PREFS;
  if (cache?.key !== k) cache = { key: k, prefs: migrateTrackPrefs(readJson<unknown>(k, null)) };
  return cache.prefs;
}

export function saveTrackPrefs(prefs: TrackPrefs): void {
  const k = key();
  if (!k) return;
  cache = { key: k, prefs };
  writeJson(k, prefs);
}
