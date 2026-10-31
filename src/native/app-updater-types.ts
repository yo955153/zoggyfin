import type { TvRelease } from '@/platform/updates/tv-feed';

/** Which settings page opened for "install unknown apps". */
export type InstallSettingsPage = 'app' | 'list' | 'settings' | 'none';

/** The native part of the Android TV self-update (`modules/zoggyfin-native`, ZoggyfinUpdaterModule.kt). */
export interface AppUpdater {
  /** The installed Android `versionCode`. */
  versionCode: number;
  versionName: string | null;
  /** True when the system lets Zoggyfin open the package installer. */
  canInstall(): boolean;
  /** Downloads the APK into the app cache and checks its SHA-256. Resolves to the file path. */
  download(release: Pick<TvRelease, 'url' | 'sha256' | 'size'>, name: string, onProgress: (done: number, total: number) => void): Promise<string>;
  /** Opens the "install unknown apps" switch of Zoggyfin, or the nearest page the device has. */
  openInstallSettings(): InstallSettingsPage;
  /** Opens the system installer for the downloaded file. */
  install(path: string): void;
}
