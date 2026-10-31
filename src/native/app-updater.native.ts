/**
 * The Android self-updater of the local module (ZoggyfinUpdaterModule.kt).
 * Null on iOS, on phones that run an older build, and in every build with no
 * REQUEST_INSTALL_PACKAGES (`selfUpdate` is false there).
 */
import { type EventSubscription, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { AppUpdater, InstallSettingsPage } from './app-updater-types';

interface Native {
  info(): { selfUpdate: boolean; versionCode: number | null; versionName: string | null };
  canInstall(): boolean;
  download(url: string, sha256: string, size: number, name: string): Promise<string>;
  openInstallSettings(): string;
  install(path: string): void;
  addListener(event: 'onProgress', listener: (e: { done: number; total: number }) => void): EventSubscription;
}

const mod = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ZoggyfinUpdater') : null;

function create(m: Native): AppUpdater | null {
  let info: ReturnType<Native['info']>;
  try {
    info = m.info();
  } catch {
    return null;
  }
  if (!info.selfUpdate || typeof info.versionCode !== 'number') return null;
  return {
    versionCode: info.versionCode,
    versionName: info.versionName,
    canInstall: () => {
      try {
        return m.canInstall();
      } catch {
        return false;
      }
    },
    download: async (release, name, onProgress) => {
      const sub = m.addListener('onProgress', (e) => onProgress(e.done, e.total));
      try {
        return await m.download(release.url, release.sha256, release.size, name);
      } finally {
        sub.remove();
      }
    },
    openInstallSettings: () => {
      const page = m.openInstallSettings();
      return page === 'app' || page === 'list' || page === 'settings' ? page : 'none';
    },
    install: (path) => m.install(path),
  };
}

export const appUpdater: AppUpdater | null = mod ? create(mod) : null;
export type { InstallSettingsPage };
