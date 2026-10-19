/**
 * Development builds only: writes the player position five times a second
 * and every drift check to `Documents/together-log.jsonl`. The spike
 * (docs/specs/watch-together-spike.md) compares two simulators with it:
 * simulators on one Mac share the monotonic clock, so the real sync error
 * is the position difference at the same clock time.
 */
import { File, Paths } from 'expo-file-system';

import type { SyncSample } from './follower';

let lines: string[] = [];
let poll: ReturnType<typeof setInterval> | null = null;
let flush: ReturnType<typeof setInterval> | null = null;
let role: 'host' | 'guest' = 'host';
let clock: () => number = () => Date.now();

function write(): void {
  if (!lines.length) return;
  try {
    const f = new File(Paths.document, 'together-log.jsonl');
    const old = f.exists ? f.textSync() : '';
    f.write(old + lines.join('\n') + '\n');
  } catch {
    // A measurement aid only.
  }
  lines = [];
}

export const syncLog = {
  start(r: 'host' | 'guest', read: () => { pos: number; playing: boolean }, now: () => number): void {
    if (!__DEV__) return;
    syncLog.stop();
    role = r;
    clock = now;
    try {
      const f = new File(Paths.document, 'together-log.jsonl');
      if (f.exists) f.delete();
    } catch {
      // Ignore.
    }
    poll = setInterval(() => {
      const { pos, playing } = read();
      lines.push(JSON.stringify({ k: 'p', r: role, t: clock(), pos, playing }));
    }, 200);
    flush = setInterval(write, 2000);
  },
  sample(s: SyncSample): void {
    if (!__DEV__ || !poll) return;
    lines.push(JSON.stringify({ k: 's', r: role, ...s }));
  },
  stop(): void {
    if (poll) clearInterval(poll);
    if (flush) clearInterval(flush);
    poll = null;
    flush = null;
    write();
  },
};
