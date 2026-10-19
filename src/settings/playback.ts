/**
 * Playback settings: streaming quality per network and skip lengths.
 * Saved on the device (MMKV on native, localStorage on web).
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

/** Bitrate choices in bits per second. `0` = no limit beyond the server's own. */
export const QUALITY_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Maximum' },
  { value: 120_000_000, label: '120 Mbps' },
  { value: 60_000_000, label: '60 Mbps' },
  { value: 40_000_000, label: '40 Mbps' },
  { value: 20_000_000, label: '20 Mbps (1080p)' },
  { value: 10_000_000, label: '10 Mbps (1080p)' },
  { value: 8_000_000, label: '8 Mbps (720p)' },
  { value: 4_000_000, label: '4 Mbps (720p)' },
  { value: 2_000_000, label: '2 Mbps (480p)' },
  { value: 1_000_000, label: '1 Mbps (360p)' },
];

export const SKIP_OPTIONS: readonly number[] = [5, 10, 15, 30, 60];

/** What "Maximum" sends to the server: high enough to never limit a local file. */
export const MAX_BITRATE = 200_000_000;

export function qualityLabel(bitrate: number): string {
  return QUALITY_OPTIONS.find((o) => o.value === bitrate)?.label ?? `${Math.round(bitrate / 1e6)} Mbps`;
}

export interface PlaybackSettings {
  wifiBitrate: number;
  cellularBitrate: number;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  autoplayNext: boolean;
}

const KEY = 'settings.playback.v1';

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  wifiBitrate: 0,
  cellularBitrate: 8_000_000,
  skipBackSeconds: 10,
  skipForwardSeconds: 10,
  autoplayNext: true,
};

interface Store extends PlaybackSettings {
  update(patch: Partial<PlaybackSettings>): void;
}

export const usePlaybackSettings = create<Store>((set, get) => ({
  ...DEFAULT_PLAYBACK_SETTINGS,
  ...readJson<Partial<PlaybackSettings>>(KEY, {}),
  update(patch) {
    set(patch);
    const s = get();
    const saved: PlaybackSettings = {
      wifiBitrate: s.wifiBitrate,
      cellularBitrate: s.cellularBitrate,
      skipBackSeconds: s.skipBackSeconds,
      skipForwardSeconds: s.skipForwardSeconds,
      autoplayNext: s.autoplayNext,
    };
    writeJson(KEY, saved);
  },
}));

/** The bitrate to request, in bits per second, for the current network. */
export function bitrateFor(settings: PlaybackSettings, cellular: boolean): number {
  const value = cellular ? settings.cellularBitrate : settings.wifiBitrate;
  return value > 0 ? value : MAX_BITRATE;
}
