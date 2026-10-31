/**
 * Self-update of the sideloaded Android TV app: the feed, the download and
 * the system installer. `./index.ts` drives it with the state of `./machine.ts`.
 *
 * - Only on a real Android TV, and only in a build whose manifest has
 *   REQUEST_INSTALL_PACKAGES (the EAS profile `tv`; see app.config.ts). The
 *   native module says so at run time, so an over-the-air update cannot turn
 *   the updater on in the Play build. `EXPO_PUBLIC_TV_SELF_UPDATE=0` turns it off.
 * - The feed URL is `TV_FEED_URL`; a test build can set another one with
 *   `EXPO_PUBLIC_TV_UPDATE_URL` (HTTPS only).
 * - "Install": the APK goes to the app cache with progress, its SHA-256 is
 *   checked, then the system installer opens. When Zoggyfin may not install
 *   apps yet, its "install unknown apps" page opens instead, and the install
 *   goes on when the user comes back with the switch on.
 */
import { AppState, Platform } from 'react-native';

import { appUpdater } from '@/native/app-updater';
import type { AppUpdater } from '@/native/app-updater-types';

import { isNativeTV } from '../tv';

import type { UpdateOffer } from './machine';
import { parseTvFeed, tvApkName, tvFeedUrl, tvOffer, type TvRelease } from './tv-feed';

const CHECK_TIMEOUT_MS = 15_000;

export interface TvUpdates {
  versionName: string;
  versionCode: number;
  /** Reads the feed. The offer can be older than the app; the state machine decides. */
  check(): Promise<UpdateOffer | null>;
  /**
   * Downloads and checks the APK, then opens the installer ('installer') or
   * the "install unknown apps" page ('permission').
   */
  install(onProgress: (done: number, total: number) => void, onDownloaded: () => void): Promise<'installer' | 'permission'>;
  canInstall(): boolean;
  openSettings(): void;
  /** App state hooks: back from the settings page, and the installer closed with no install. */
  watch(hooks: { onResume: () => void; onInstallerClosed: () => void; installing: () => boolean }): void;
}

export function createTvUpdates(native: AppUpdater, feedUrl: string, fetcher: typeof fetch = fetch): TvUpdates {
  let release: TvRelease | null = null;

  async function readFeed(): Promise<TvRelease> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const res = await fetcher(feedUrl, { headers: { 'Cache-Control': 'no-cache' }, signal: controller.signal });
      if (!res.ok) throw new Error(`The update server answered ${res.status}.`);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error('The update feed is not valid.');
      }
      return parseTvFeed(json, feedUrl);
    } catch (err) {
      if (controller.signal.aborted) throw new Error('The update server did not answer.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    versionName: native.versionName ?? '0.0.0',
    versionCode: native.versionCode,
    async check() {
      release = await readFeed();
      return tvOffer(release, native.versionCode);
    },
    async install(onProgress, onDownloaded) {
      const r = release ?? (release = await readFeed());
      const path = await native.download(r, tvApkName(r), onProgress);
      onDownloaded();
      if (!native.canInstall()) {
        native.openInstallSettings();
        return 'permission';
      }
      native.install(path);
      return 'installer';
    },
    canInstall: () => native.canInstall(),
    openSettings: () => {
      native.openInstallSettings();
    },
    watch({ onResume, onInstallerClosed, installing }) {
      let away = false;
      AppState.addEventListener('change', (next) => {
        if (next !== 'active') {
          away = true;
          return;
        }
        if (!away) return;
        away = false;
        if (installing()) onInstallerClosed();
        else onResume();
      });
    },
  };
}

const enabled = Platform.OS === 'android' && isNativeTV && appUpdater !== null && process.env.EXPO_PUBLIC_TV_SELF_UPDATE !== '0';

/** The Android TV updater, or null where the app does not update itself. */
export const tvUpdates: TvUpdates | null = enabled && appUpdater ? createTvUpdates(appUpdater, tvFeedUrl(process.env.EXPO_PUBLIC_TV_UPDATE_URL)) : null;
