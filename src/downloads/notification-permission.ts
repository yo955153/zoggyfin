/**
 * Android 13 and later: a notification needs the POST_NOTIFICATIONS
 * permission, else Android hides the download notification (the foreground
 * service of a download still runs). The app asks once, in context: the
 * first time the user starts a download. A "no" changes nothing for the
 * downloads. Media playback notifications are exempt, so a play does not ask.
 */
import { Alert, PermissionsAndroid, Platform } from 'react-native';

import { storage } from '@/storage/kv';

const ASKED = 'downloads.notifications-asked';
export const NOTIFICATION_REASON = 'Allow notifications to see download progress';

export interface PermissionDeps {
  os: string;
  version: number;
  asked(): boolean;
  markAsked(): void;
  granted(): Promise<boolean>;
  /** Shows the reason; true when the user wants the system prompt. */
  explain(): Promise<boolean>;
  request(): Promise<boolean>;
}

const realDeps: PermissionDeps = {
  os: Platform.OS,
  version: typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version),
  asked: () => storage.getString(ASKED) === '1',
  markAsked: () => storage.set(ASKED, '1'),
  granted: () => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS),
  explain: () =>
    new Promise((resolve) => {
      Alert.alert('Download notifications', NOTIFICATION_REASON, [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ]);
    }),
  request: async () => (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) === PermissionsAndroid.RESULTS.GRANTED,
};

/** Asks for the notification permission before the first download (Android 13+, once). Never throws. */
export async function askForDownloadNotifications(deps: PermissionDeps = realDeps): Promise<void> {
  try {
    if (deps.os !== 'android' || deps.version < 33 || deps.asked()) return;
    deps.markAsked();
    if (await deps.granted()) return;
    if (await deps.explain()) await deps.request();
  } catch {
    // The download goes on without a visible notification.
  }
}
