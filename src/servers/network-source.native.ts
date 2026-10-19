/**
 * The Wi-Fi name on iOS and Android, through @react-native-community/netinfo,
 * and the location permission (iOS gives the Wi-Fi name only with it),
 * through expo-location.
 *
 * Both native modules came after the first TestFlight build. Over-the-air
 * updates bring this code to binaries that do not have them, so the modules
 * load only after a check, and a binary without them reports `available: false`.
 */
import { requireOptionalNativeModule } from 'expo';
import { NativeModules, TurboModuleRegistry } from 'react-native';

import type { NetworkSource } from './network-source-types';
import type { NetworkSnapshot, NetworkType } from './wifi-rule';

export type { NetworkSource } from './network-source-types';

type NetInfoModule = typeof import('@react-native-community/netinfo').default;
type LocationModule = typeof import('expo-location');

function hasNetInfo(): boolean {
  try {
    return !!(TurboModuleRegistry.get('RNCNetInfo') ?? NativeModules.RNCNetInfo);
  } catch {
    return false;
  }
}

let netInfo: NetInfoModule | null | undefined;
function loadNetInfo(): NetInfoModule | null {
  if (netInfo !== undefined) return netInfo;
  netInfo = null;
  if (!hasNetInfo()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo').default as NetInfoModule;
    mod.configure({ shouldFetchWiFiSSID: true });
    netInfo = mod;
  } catch {
    netInfo = null;
  }
  return netInfo;
}

let location: LocationModule | null | undefined;
function loadLocation(): LocationModule | null {
  if (location !== undefined) return location;
  location = null;
  try {
    if (!requireOptionalNativeModule('ExpoLocation')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    location = require('expo-location') as LocationModule;
  } catch {
    location = null;
  }
  return location;
}

function typeOf(t: string): NetworkType {
  switch (t) {
    case 'wifi':
    case 'cellular':
    case 'ethernet':
    case 'none':
    case 'unknown':
      return t;
    default:
      return 'other';
  }
}

export const networkSource: NetworkSource = {
  get available() {
    return loadNetInfo() !== null && loadLocation() !== null;
  },
  snapshot: async (): Promise<NetworkSnapshot | null> => {
    const ni = loadNetInfo();
    if (!ni) return null;
    try {
      const st = await ni.fetch();
      const type = typeOf(st.type);
      const ssid = type === 'wifi' ? ((st.details as { ssid?: string | null } | null)?.ssid ?? null) : null;
      return { type, ssid };
    } catch {
      return null;
    }
  },
  requestPermission: async () => {
    const loc = loadLocation();
    if (!loc) return false;
    try {
      const res = await loc.requestForegroundPermissionsAsync();
      return res.granted;
    } catch {
      return false;
    }
  },
};
