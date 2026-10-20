/**
 * Web and TV: no downloads. The desktop app (Tauri) downloads in Rust
 * (`desktop.ts`). Native builds use `engine.native.ts`.
 */
import { dataDir, invoke, onDownloadEvent } from '@/platform/desktop';

import { createDesktopEngine } from './desktop';
import type { DownloadEngine } from './engine-types';

const none: DownloadEngine = {
  supported: false,
  configure: () => undefined,
  start: () => undefined,
  pause: async () => undefined,
  resume: async () => false,
  stop: async () => undefined,
  existing: async () => [],
  finish: () => undefined,
};

export const engine: DownloadEngine = dataDir ? createDesktopEngine(invoke, onDownloadEvent) : none;
