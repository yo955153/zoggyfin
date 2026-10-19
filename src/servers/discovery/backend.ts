/**
 * Web and desktop. A browser cannot send UDP or scan the network safely, so
 * the web shows no discovery. The desktop app (Tauri) sends the UDP
 * broadcast and reads the interfaces in Rust (`desktop/src-tauri/src/discovery.rs`);
 * the page runs the HTTP scan.
 */
import { invoke, isDesktop } from '@/platform/desktop';

import { hasVpnInterface } from '../address-class';

import type { DiscoveryBackend, LocalInterface } from './backend-types';
import { fetchJson } from './fetch-json';
import type { LanAccess } from './lan-access';

export type { DiscoveryBackend, LocalInterface } from './backend-types';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');

const none: DiscoveryBackend = {
  available: false,
  asksLanAccess: false,
  udpSupported: false,
  udp: async () => ({ answers: [], blocked: false }),
  interfaces: async () => [],
  lanAccess: async () => 'unknown',
  vpnActive: async () => false,
  openSettings: async () => undefined,
  fetchJson,
};

const PROBE_EVERY_MS = 750;

const desktop: DiscoveryBackend = {
  available: true,
  asksLanAccess: isMac,
  udpSupported: true,
  udp: (timeoutMs) => invoke<{ answers: string[]; blocked: boolean }>('discovery_udp', { timeoutMs }),
  interfaces: () => invoke<LocalInterface[]>('discovery_interfaces'),
  // macOS refuses sends to the local network until the user allows it. The
  // first probe shows the prompt; then the probe repeats until a send goes out.
  lanAccess: async (timeoutMs) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const r = await invoke<'ok' | 'blocked' | 'error'>('discovery_lan_probe').catch(() => 'error' as const);
      if (r === 'ok') return 'granted' satisfies LanAccess;
      if (r === 'error' || Date.now() >= end) return r === 'blocked' ? 'denied' : 'unknown';
      await new Promise((resolve) => setTimeout(resolve, PROBE_EVERY_MS));
    }
  },
  vpnActive: () => invoke<LocalInterface[]>('discovery_interfaces').then(hasVpnInterface, () => false),
  openSettings: () => invoke<void>('discovery_open_settings'),
  fetchJson,
};

export const discoveryBackend: DiscoveryBackend = isDesktop ? desktop : none;
