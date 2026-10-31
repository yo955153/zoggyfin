/**
 * Provider secrets in the secure store (keychain, keystore; localStorage on
 * the web, like the Jellyfin token): the Xtream user name and password and
 * every M3U and XMLTV URL. Never in MMKV, logs or error texts.
 */
import { secureStore } from '@/storage/secure';

import type { ProviderSecrets } from './types';

const keyOf = (providerId: string) => `iptv.${providerId}`;

export function readSecrets(providerId: string): ProviderSecrets {
  const raw = secureStore.get(keyOf(providerId));
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return {};
    const o = v as Record<string, unknown>;
    const out: ProviderSecrets = {};
    for (const k of ['username', 'password', 'playlistUrl', 'guideUrl', 'playlistGuideUrl'] as const) {
      if (typeof o[k] === 'string' && o[k]) out[k] = o[k];
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSecrets(providerId: string, secrets: ProviderSecrets): void {
  secureStore.set(keyOf(providerId), JSON.stringify(secrets));
}

export function removeSecrets(providerId: string): void {
  secureStore.remove(keyOf(providerId));
}
