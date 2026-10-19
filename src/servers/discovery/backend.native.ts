/**
 * iOS and Android. The UDP broadcast and the local network check are in the
 * local module `modules/zoggyfin-discovery`. It is optional: a binary
 * without it (an over-the-air update to an older build) still runs the HTTP
 * scan with the address from netinfo.
 */
import { requireOptionalNativeModule } from 'expo';
import { Linking, NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { hasVpnInterface } from '../address-class';

import type { DiscoveryBackend, LocalInterface } from './backend-types';
import { fetchJson } from './fetch-json';
import type { LanAccess } from './lan-access';

export type { DiscoveryBackend, LocalInterface } from './backend-types';

interface DiscoveryModule {
  udpSupported: boolean;
  interfaces(): LocalInterface[];
  localNetworkAccess(timeoutMs: number): Promise<string>;
  discover(timeoutMs: number): Promise<string[]>;
}

const mod = requireOptionalNativeModule<DiscoveryModule>('ZoggyfinDiscovery');

type NetInfoModule = typeof import('@react-native-community/netinfo').default;

function netInfo(): NetInfoModule | null {
  try {
    if (!(TurboModuleRegistry.get('RNCNetInfo') ?? NativeModules.RNCNetInfo)) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-community/netinfo').default as NetInfoModule;
  } catch {
    return null;
  }
}

/** The address of the active Wi-Fi or Ethernet network from netinfo. */
async function netInfoInterface(): Promise<LocalInterface | null> {
  const ni = netInfo();
  if (!ni) return null;
  try {
    const st = await ni.fetch();
    if (st.type !== 'wifi' && st.type !== 'ethernet') return null;
    const d = st.details as { ipAddress?: string | null; subnet?: string | null } | null;
    return d?.ipAddress && d.subnet ? { address: d.ipAddress, netmask: d.subnet } : null;
  } catch {
    return null;
  }
}

function asAccess(v: string): LanAccess {
  return v === 'granted' || v === 'denied' ? v : 'unknown';
}

export const discoveryBackend: DiscoveryBackend = {
  available: true,
  // tvOS has no local network prompt.
  asksLanAccess: Platform.OS === 'ios' && !Platform.isTV,
  udpSupported: mod?.udpSupported === true,
  udp: async (timeoutMs) => {
    if (!mod?.udpSupported) return { answers: [], blocked: false };
    try {
      return { answers: await mod.discover(timeoutMs), blocked: false };
    } catch {
      return { answers: [], blocked: false };
    }
  },
  interfaces: async () => {
    const out: LocalInterface[] = [];
    const active = await netInfoInterface();
    if (active) out.push(active);
    try {
      for (const i of mod?.interfaces() ?? []) if (!out.some((o) => o.address === i.address)) out.push(i);
    } catch {
      // No module: netinfo only.
    }
    return out;
  },
  lanAccess: async (timeoutMs) => {
    if (Platform.OS !== 'ios' || Platform.isTV) return 'granted';
    if (!mod) return 'unknown';
    try {
      return asAccess(await mod.localNetworkAccess(timeoutMs));
    } catch {
      return 'unknown';
    }
  },
  vpnActive: async () => {
    try {
      if (hasVpnInterface(mod?.interfaces() ?? [])) return true;
      return (await netInfo()?.fetch())?.type === 'vpn';
    } catch {
      return false;
    }
  },
  openSettings: () => Linking.openSettings(),
  fetchJson,
};
