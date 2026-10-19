/**
 * Development only: "Admin fixture data". When it is on, every saved server
 * shows the Admin panel with made-up data (fixtures.ts) and no request goes
 * to a server. Turn it on in Settings → Development, or on the web with
 * `?adminFixtures=1` in the address. Release builds never use it.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';

import { storage } from '@/storage/kv';

const KEY = 'dev.adminFixtures';

function fromUrl(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('adminFixtures') === '1';
  } catch {
    return false;
  }
}

function initial(): boolean {
  if (!__DEV__) return false;
  if (fromUrl()) {
    storage.set(KEY, '1');
    return true;
  }
  return storage.getString(KEY) === '1';
}

export const useAdminFixtureStore = create<{ on: boolean }>(() => ({ on: initial() }));

export function adminFixtures(): boolean {
  return __DEV__ && useAdminFixtureStore.getState().on;
}

export function useAdminFixtures(): boolean {
  return useAdminFixtureStore((s) => __DEV__ && s.on);
}

export function setAdminFixtures(on: boolean): void {
  if (!__DEV__) return;
  if (on) storage.set(KEY, '1');
  else storage.remove(KEY);
  useAdminFixtureStore.setState({ on });
}
