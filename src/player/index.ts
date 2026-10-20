/**
 * The app-level player interface. Screens call `usePlayer().play(...)` and
 * never talk to an engine. Video plays through expo-video (native) or an
 * HTML video element (web), behind `session.ts`; audio plays through
 * expo-audio behind `audio/session.ts`. One of them plays at a time.
 */
import { router } from 'expo-router';

import type { BaseItemDto } from '@/api/types';

import { toast } from '@/lib/toast';

import { audioSession } from './audio/session';
import { playRouter } from './play-router';
import { videoSession } from './session';
import { playerState, setPlayerState } from './store';
import type { PlayerController, PlayRequest } from './types';

export type { PlayerController, PlayRequest } from './types';
export { usePlayerStore } from './store';
export { playRouter } from './play-router';

const AUDIO_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum', 'MusicArtist', 'MusicGenre']);

export function isAudioItem(item: BaseItemDto): boolean {
  if (item.Type === 'Playlist') return item.MediaType === 'Audio';
  return AUDIO_TYPES.has(item.Type ?? '') || item.MediaType === 'Audio';
}

/** Opens the full player for what plays now: the music player for audio, the video player for video. */
export function openFullPlayer(): void {
  if (playerState().presentation !== 'full') setPlayerState({ presentation: 'full' });
  router.navigate(playerState().now?.kind === 'audio' ? '/now-playing' : '/player');
}

/** Transport for whatever plays now (mini player, keyboard shortcuts). */
export const activePlayback = {
  togglePlay(): void {
    if (playerState().now?.kind === 'audio') audioSession().togglePlay();
    else videoSession().togglePlay();
  },
  stop(): void {
    if (playerState().now?.kind === 'audio') void audioSession().stop();
    else void videoSession().stop();
  },
  next(): void {
    if (playerState().now?.kind === 'audio') audioSession().next();
    else void videoSession().playNext();
  },
  previous(): void {
    if (playerState().now?.kind === 'audio') audioSession().previous();
  },
  skip(seconds: number): void {
    if (playerState().now?.kind === 'audio') audioSession().skip(seconds);
    else videoSession().skip(seconds);
  },
};

/**
 * Plays a request on this device, with no together routing. The together
 * host uses it for a guest's pick; screens use `usePlayer().play`.
 */
export function playHere(request: PlayRequest): void {
  if (isAudioItem(request.item)) {
    void (async () => {
      if (playerState().now?.kind === 'video') await videoSession().stop();
      await audioSession().play(request);
    })();
    return;
  }
  void (async () => {
    if (playerState().now?.kind === 'audio') await audioSession().stopForVideo();
    await videoSession().play(request);
  })();
  router.navigate('/player');
}

/** True when a together session lets this device change its queue; else says why. */
function queueAllowed(): boolean {
  const lock = playRouter.queueLock();
  if (lock) toast(lock, { icon: 'lock.fill' });
  return !lock;
}

const controller: PlayerController = {
  available: true,
  play(request) {
    // In a together session the session decides first (play-router.ts).
    const routed = playRouter.route(request, 'user');
    if (routed) playHere(routed);
  },
  playNext(item) {
    if (queueAllowed()) void audioSession().playNext(item);
  },
  addToQueue(item) {
    if (queueAllowed()) void audioSession().addToQueue(item);
  },
  instantMix(item) {
    if (queueAllowed()) void audioSession().instantMix(item);
  },
};

export function usePlayer(): PlayerController {
  return controller;
}
