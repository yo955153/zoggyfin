/**
 * The download engine: the only part that talks to the native background
 * downloader. The manager and the screens never import the library.
 */
import type { ResumeHint } from './resume';

export interface EngineHandlers {
  /** `validator` is the ETag or Last-Modified of the response, when the engine knows it. */
  onBegin(id: string, expectedBytes: number, validator?: string | null): void;
  onProgress(id: string, bytesDone: number, bytesTotal: number): void;
  onDone(id: string, bytes: number): void;
  onError(id: string, message: string, code: number): void;
}

export interface ExistingTask {
  id: string;
  state: 'downloading' | 'paused' | 'done' | 'failed' | 'other';
  bytesDone: number;
  bytesTotal: number;
}

export interface DownloadEngine {
  readonly supported: boolean;
  configure(handlers: EngineHandlers, opts: { maxParallel: number }): void;
  /**
   * Starts a download. With `resume`, a partial file of an earlier try stays
   * and the download continues from it (HTTP Range) when the server allows
   * it; else it starts over from 0.
   */
  start(task: { id: string; url: string; destination: string; headers?: Record<string, string>; resume?: ResumeHint }): void;
  pause(id: string): Promise<void>;
  /** Continues a paused task. False when the engine has no task for `id` (the manager then starts it again). */
  resume(id: string): Promise<boolean>;
  stop(id: string): Promise<void>;
  /** Tasks that the system kept while the app was not running. Binds them to the handlers. */
  existing(): Promise<ExistingTask[]>;
  /** Tells the system that a finished task was handled (lets iOS release the background session). */
  finish(id: string): void;
}
