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
  /** Start playing when ready (default true). False loads paused at `startSeconds`. */
  autoplay?: boolean;
  /** Engines with `tracks`: the audio stream to start with (Jellyfin stream index). */
  audioIndex?: number | null;
  /** Engines with `tracks`: Jellyfin indexes of the streams inside the file, in file order. */
  streams?: { audio: number[]; subtitles: number[] };
}

/** A subtitle for an engine that draws subtitles itself. */
export interface EngineSubtitle {
  /** Jellyfin stream index (the stream index in the file for embedded subtitles). */
  index: number;
  /** A separate subtitle file to load, or null for a subtitle inside the video file. */
  url: string | null;
  label: string;
  language: string | null;
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
  /**
   * Engines that switch the audio and subtitle tracks inside a direct-played
   * file themselves (libmpv in the desktop app). Without it, the server makes
   * a new stream for another audio track, and the app draws text subtitles.
   */
  tracks?: {
    selectAudio(index: number): void;
    /** null turns subtitles off. */
    selectSubtitle(subtitle: EngineSubtitle | null): void;
  };
  subscribe(listener: EngineListener): () => void;
}
