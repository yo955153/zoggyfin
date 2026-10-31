/** Web and iOS: no APK self-update. Android resolves `app-updater.native.ts`. */
import type { AppUpdater, InstallSettingsPage } from './app-updater-types';

export const appUpdater: AppUpdater | null = null;
export type { InstallSettingsPage };
