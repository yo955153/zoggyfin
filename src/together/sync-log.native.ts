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

let events: string[] = [];

/** Session events (development builds): `Documents/together-events.jsonl`, kept across role changes. */
function writeEvents(): void {
  if (!events.length) return;
  try {
    const f = new File(Paths.document, 'together-events.jsonl');
    const old = f.exists ? f.textSync() : '';
    f.write(old + events.join('\n') + '\n');
  } catch {
    // A measurement aid only.
  }
  events = [];
}

export const syncLog = {
  event(t: number, msg: string, data?: object): void {
    if (!__DEV__) return;
    events.push(JSON.stringify({ k: 'e', t, msg, ...data }));
    setTimeout(writeEvents, 0);
  },
  /** `fresh`: a new session (the old log goes). A role change in the same session keeps the log. */
  start(r: 'host' | 'guest', read: () => { pos: number; playing: boolean; track?: string | null }, now: () => number, fresh = true): void {
    if (!__DEV__) return;
    syncLog.stop();
    role = r;
    clock = now;
    if (fresh) {
      try {
        for (const name of ['together-log.jsonl', 'together-events.jsonl']) {
          const f = new File(Paths.document, name);
          if (f.exists) f.delete();
        }
      } catch {
        // Ignore.
      }
    }
    poll = setInterval(() => {
      const { pos, playing, track } = read();
      lines.push(JSON.stringify({ k: 'p', r: role, t: clock(), pos, playing, ...(track ? { tr: track } : {}) }));
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
