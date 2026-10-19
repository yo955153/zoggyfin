/**
 * Audio-only player state: the queue, long-form mode, the sleep timer and
 * lyrics. The shared `usePlayerStore` still holds what every player shows
 * (item, playing, position), so the mini player reads one place.
 */
import { create } from 'zustand';

import type { AudioItem } from './item';
import type { Lyrics } from './lyrics';
import { emptyQueue, type QueueState } from './queue';
import { sleepOff, type SleepTimer } from './sleep-timer';

export type LyricsState =
  | { itemId: string; status: 'loading' }
  | { itemId: string; status: 'none' }
  | { itemId: string; status: 'ready'; lyrics: Lyrics };

export interface AudioState {
  queue: QueueState<AudioItem>;
  /** Long-form player: speed, ±15/30 s, sleep timer, per-item resume. */
  longForm: boolean;
  sleep: SleepTimer;
  /** When playback resumed from a saved position (ms), for the "Resumes where you left off" caption. */
  resumedAt: number | null;
  lyrics: LyricsState | null;
  /** "MP3 · 128 kbps" under the scrubber. */
  format: string | null;
  /** The volume set by the app (sleep timer fade), 0–1. */
  volume: number;
}

export const initialAudioState: AudioState = {
  queue: emptyQueue<AudioItem>(),
  longForm: false,
  sleep: sleepOff,
  resumedAt: null,
  lyrics: null,
  format: null,
  volume: 1,
};

export const useAudioStore = create<AudioState>(() => initialAudioState);

export const audioState = () => useAudioStore.getState();
export const setAudioState = (patch: Partial<AudioState>) => useAudioStore.setState(patch);
