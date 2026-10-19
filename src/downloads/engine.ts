/** Web and TV: no downloads. Native builds use `engine.native.ts`. */
import type { DownloadEngine } from './engine-types';

export const engine: DownloadEngine = {
  supported: false,
  configure: () => undefined,
  start: () => undefined,
  pause: async () => undefined,
  resume: async () => undefined,
  stop: async () => undefined,
  existing: async () => [],
  finish: () => undefined,
};
