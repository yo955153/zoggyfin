/** Web: no sync log (the spike measured the native apps). */
import type { SyncSample } from './follower';

export const syncLog = {
  start(_role: 'host' | 'guest', _read: () => { pos: number; playing: boolean }, _now: () => number): void {},
  sample(_s: SyncSample): void {},
  stop(): void {},
};
