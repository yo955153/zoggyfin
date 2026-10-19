/**
 * Starts the offline services once a session exists: the reachability
 * checks, the download manager (re-attach to system tasks) and the outbox,
 * which sends offline play progress whenever the server answers again.
 */
import { downloads, downloadsSupported } from '@/downloads';
import { flushOutbox } from '@/downloads/outbox-store';
import { startReachability, useOnlineStore } from '@/lib/online';

let started = false;

export function startOfflineServices(): void {
  if (started) return;
  started = true;
  startReachability();
  if (downloadsSupported) void downloads.init();
  useOnlineStore.subscribe((s, prev) => {
    if (s.reachable && prev.reachable !== true) void flushOutbox();
  });
}
