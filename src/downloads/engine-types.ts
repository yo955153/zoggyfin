/**
 * The download engine: the only part that talks to the native background
 * downloader. The manager and the screens never import the library.
 */
export interface EngineHandlers {
  onBegin(id: string, expectedBytes: number): void;
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
  start(task: { id: string; url: string; destination: string; headers?: Record<string, string> }): void;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  /** Tasks that the system kept while the app was not running. Binds them to the handlers. */
  existing(): Promise<ExistingTask[]>;
  /** Tells the system that a finished task was handled (lets iOS release the background session). */
  finish(id: string): void;
}
