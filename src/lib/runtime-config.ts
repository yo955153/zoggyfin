/**
 * Optional runtime config for self-hosted web builds: `/config.json` next to
 * index.html, for example `{ "defaultServerUrl": "http://jellyfin.lan:8096" }`.
 * Native builds have no such file. A missing or broken file means no config.
 */
import { Platform } from 'react-native';

export interface RuntimeConfig {
  defaultServerUrl?: string;
}

export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  if (typeof raw !== 'object' || raw === null) return {};
  const url = (raw as { defaultServerUrl?: unknown }).defaultServerUrl;
  return typeof url === 'string' && url.trim() ? { defaultServerUrl: url.trim() } : {};
}

let pending: Promise<RuntimeConfig> | null = null;

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (Platform.OS !== 'web') return Promise.resolve({});
  if (!pending) {
    pending = fetch('/config.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(parseRuntimeConfig)
      .catch(() => ({}));
  }
  return pending;
}
