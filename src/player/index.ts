/**
 * The app-level player interface. Screens call `usePlayer().play(...)` and
 * never talk to an engine. Video plays through expo-video (native) or an
 * HTML video element (web), behind `session.ts`. Audio arrives in phase 3.
 */
import { router } from 'expo-router';

import type { BaseItemDto } from '@/api/types';
import { toast } from '@/lib/toast';

import { videoSession } from './session';
import { playerState, setPlayerState } from './store';
import type { PlayerController } from './types';

export type { PlayerController, PlayRequest } from './types';
export { usePlayerStore } from './store';

const AUDIO_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum', 'MusicArtist', 'Playlist']);

export function isAudioItem(item: BaseItemDto): boolean {
  if (item.Type === 'Playlist') return item.MediaType === 'Audio';
  return AUDIO_TYPES.has(item.Type ?? '') || item.MediaType === 'Audio';
}

/** Opens the full-screen player. Safe to call when it already shows. */
export function openFullPlayer(): void {
  if (playerState().presentation !== 'full') setPlayerState({ presentation: 'full' });
  router.navigate('/player');
}

const controller: PlayerController = {
  available: true,
  play(request) {
    if (isAudioItem(request.item)) {
      toast('Music playback is coming in the next update.');
      return;
    }
    void videoSession().play(request);
    router.navigate('/player');
  },
};

export function usePlayer(): PlayerController {
  return controller;
}
