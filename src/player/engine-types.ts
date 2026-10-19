/**
 * The engine seam: one interface over expo-video (native) and an HTML video
 * element with hls.js (web). The session drives it; screens never touch it.
 */

export interface EngineSource {
  uri: string;
  isHls: boolean;
  /** Where to start, in seconds. */
  startSeconds: number;
  /** Lock screen / Now Playing metadata. */
  title: string;
  subtitle?: string;
  artworkUri?: string;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export type EngineEvent =
  | { type: 'status'; status: EngineStatus; error?: string }
  | { type: 'playing'; playing: boolean }
  | { type: 'time'; position: number; buffered: number }
  | { type: 'duration'; duration: number }
  | { type: 'rate'; rate: number }
  | { type: 'muted'; muted: boolean }
  | { type: 'ended' }
  | { type: 'pip'; active: boolean }
  /** A remote command from the lock screen or a headset (web Media Session). */
  | { type: 'remote'; command: 'next' | 'previous' };

export type EngineListener = (event: EngineEvent) => void;

export interface VideoEngine {
  load(source: EngineSource): void;
  unload(): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setRate(rate: number): void;
  setMuted(muted: boolean): void;
  readonly position: number;
  readonly pipSupported: boolean;
  startPip(): void;
  /** Web only: full screen for the element that holds the player. */
  toggleFullscreen?(element: unknown): void;
  subscribe(listener: EngineListener): () => void;
}
