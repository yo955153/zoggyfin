/**
 * Web: no sync log. The desktop app's development build (with
 * ZOGGYFIN_AUTOMATION) writes the same lines as the native log
 * (`sync-log.native.ts`) to the automation folder's `out.log`, prefixed with
 * "sync ", so a Mac and a simulator can be compared on one clock (the
 * monotonic clock of the transport: the Mac's uptime on both).
 */
import { invoke, isDesktop } from '@/platform/desktop';

import type { SyncSample } from './follower';

let poll: ReturnType<typeof setInterval> | null = null;
let role: 'host' | 'guest' = 'host';
let clock: () => number = () => Date.now();

const on = (): boolean => isDesktop && typeof __DEV__ !== 'undefined' && __DEV__;

function write(line: object): void {
  void invoke('debug_log', { line: `sync ${JSON.stringify(line)}` }).catch(() => undefined);
}

export const syncLog = {
  event(t: number, msg: string, data?: object): void {
    if (on()) write({ k: 'e', t, msg, ...data });
  },
  start(r: 'host' | 'guest', read: () => { pos: number; playing: boolean; track?: string | null }, now: () => number, _fresh = true): void {
    if (!on()) return;
    syncLog.stop();
    role = r;
    clock = now;
    poll = setInterval(() => {
      const { pos, playing, track } = read();
      write({ k: 'p', r: role, t: clock(), pos, playing, ...(track ? { tr: track } : {}) });
    }, 200);
  },
  sample(s: SyncSample): void {
    if (!on() || !poll) return;
    write({ k: 's', r: role, ...s });
  },
  stop(): void {
    if (poll) clearInterval(poll);
    poll = null;
  },
};
