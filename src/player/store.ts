/**
 * The shared player state. Engine-agnostic: the video session writes it now,
 * and the audio queue (phase 3) writes the same store, so the mini player and
 * Now Playing UI read one place.
 */
import { create } from 'zustand';

import type { BaseItemDto } from '@/api/types';

import type { VideoTrackInfo } from './engine-types';
import type { Segment } from './segments';
import type { StreamPlan } from './stream';
import type { Chapter, Trickplay } from './timeline';
import type { LiveChannelRef, LiveSource } from './types';
import type { Cue } from './vtt';

export type PlayerKind = 'video' | 'audio';
export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'buffering' | 'ended' | 'error';
/** Where the player shows: the full-screen player, the mini player, or nowhere. */
export type Presentation = 'full' | 'mini' | 'hidden';

export interface NowPlaying {
  kind: PlayerKind;
  item: BaseItemDto;
  /** What plays after this item (album tracks, the next episode). */
  queue: BaseItemDto[];
  plan: StreamPlan;
  segments: Segment[];
  chapters: Chapter[];
  trickplay: Trickplay | null;
  /** The quality the user picked for this session, or null for the setting. */
  bitrateChoice: number | null;
  /** The bitrate sent to the server for the current stream. */
  bitrate: number;
  next: BaseItemDto | null;
  /** A live channel (IPTV): no duration, no seeking; channel up and down move through `channels`. */
  live?: LiveNow;
}

export interface LiveNow {
  channels: LiveChannelRef[];
  index: number;
  source: LiveSource;
}

export interface PlayerState {
  now: NowPlaying | null;
  status: PlayerStatus;
  error: string | null;
  playing: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  buffered: number;
  rate: number;
  muted: boolean;
  presentation: Presentation;
  pip: boolean;
  /** Cues of the selected text subtitle, or null. */
  cues: Cue[] | null;
  /** The video track the engine reports for the current stream, or null. */
  video: VideoTrackInfo | null;
}

export const initialPlayerState: PlayerState = {
  now: null,
  status: 'idle',
  error: null,
  playing: false,
  position: 0,
  duration: 0,
  buffered: 0,
  rate: 1,
  muted: false,
  presentation: 'hidden',
  pip: false,
  cues: null,
  video: null,
};

export const usePlayerStore = create<PlayerState>(() => initialPlayerState);

export const playerState = () => usePlayerStore.getState();
export const setPlayerState = (patch: Partial<PlayerState>) => usePlayerStore.setState(patch);
