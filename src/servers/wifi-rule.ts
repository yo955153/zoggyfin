/**
 * The Wi-Fi rule of a server: on one of the named Wi-Fi networks use the
 * internal address; on any other Wi-Fi or on cellular use the external one.
 * Pure, so it is unit-tested with a fake network snapshot.
 */
import type { AddressKind } from './addresses';

export interface WifiRule {
  enabled: boolean;
  /** Wi-Fi network names (SSIDs). They are compared exactly, after trimming spaces. */
  ssids: string[];
}

export const NO_WIFI_RULE: WifiRule = { enabled: false, ssids: [] };

export type NetworkType = 'wifi' | 'cellular' | 'ethernet' | 'none' | 'other' | 'unknown';

export interface NetworkSnapshot {
  type: NetworkType;
  /** The Wi-Fi name. Null when not on Wi-Fi or when the system does not tell it (no permission). */
  ssid: string | null;
}

/** The address kind that the rule asks for, or null when it has no opinion. */
export function wifiPreference(rule: WifiRule | null | undefined, net: NetworkSnapshot | null): AddressKind | null {
  if (!rule?.enabled || !net) return null;
  const names = cleanSsids(rule.ssids);
  if (!names.length) return null;
  if (net.type === 'cellular') return 'external';
  if (net.type !== 'wifi') return null;
  const ssid = net.ssid?.trim();
  // Without a name (no permission) the rule cannot tell home from away.
  if (!ssid) return null;
  return names.includes(ssid) ? 'internal' : 'external';
}

/** Trims names, drops empty ones and repeats. */
export function cleanSsids(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Splits what the user typed ("Home, Home 5G") into names. */
export function parseSsidList(text: string): string[] {
  return cleanSsids(text.split(/[,\n]/));
}
