import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type { ClientIdentity } from '@/api/auth-header';
import { randomId } from '@/lib/id';
import { storage } from '@/storage/kv';

const DEVICE_ID_KEY = 'device.id';

function deviceId(): string {
  const existing = storage.getString(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomId();
  storage.set(DEVICE_ID_KEY, id);
  return id;
}

let cached: ClientIdentity | null = null;

/** How this install identifies itself to Jellyfin. The device ID is stable across launches. */
export function clientIdentity(): ClientIdentity {
  if (!cached) {
    cached = {
      client: 'Zoggyfin',
      device: Device.modelName ?? Device.deviceName ?? (Platform.OS === 'web' ? 'Web Browser' : 'Device'),
      deviceId: deviceId(),
      version: Application.nativeApplicationVersion ?? '0.1.0',
    };
  }
  return cached;
}
