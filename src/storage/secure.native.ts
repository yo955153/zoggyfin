import * as SecureStore from 'expo-secure-store';

/** Secrets (access tokens) go to the iOS keychain / Android keystore. */
export const secureStore = {
  get(key: string): string | null {
    try {
      return SecureStore.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    SecureStore.setItem(key, value);
  },
  remove(key: string): void {
    SecureStore.deleteItemAsync(key).catch(() => undefined);
  },
};
