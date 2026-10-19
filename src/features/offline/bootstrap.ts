/**
 * Starts the offline services once a session exists: the reachability
 * checks, the download manager (re-attach to system tasks) and the outbox,
 * which sends offline play progress whenever a server answers again (each
 * account's progress to its own server).
 */
import { downloads, downloadsSupported } from '@/downloads';
import { flushOutbox, hasOtherAccountEntries } from '@/downloads/outbox-store';
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
  // Progress of downloads from other servers: probe those servers in the background
  // and send it when they answer. The active account does not change.
  void flushOutbox();
  setInterval(() => {
    if (hasOtherAccountEntries()) void flushOutbox();
  }, 2 * 60_000);
}
