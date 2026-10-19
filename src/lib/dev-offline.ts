/**
 * Development only: "Simulate no server". Every request to the server then
 * fails like a lost connection, so offline playback, the banner and the
 * outbox can be tested on a simulator. Off in release builds.
 */
import { storage } from '@/storage/kv';

const KEY = 'dev.simulateOffline';

export function devOffline(): boolean {
  return __DEV__ && storage.getString(KEY) === '1';
}

export function setDevOffline(on: boolean): void {
  if (on) storage.set(KEY, '1');
  else storage.remove(KEY);
}

/** The error axios gives for a lost connection. */
export function offlineError(): Error & { code: string } {
  return Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
}
