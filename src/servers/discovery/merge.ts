import type { DiscoveredServer } from './types';

/** Jellyfin writes Ids with and without dashes. */
export function idKey(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

/**
 * Adds `incoming` to `list`, one entry per server Id. The address from a UDP
 * answer wins (the server chose it); a known version and name are kept.
 * Returns the same array when nothing changed, so React can skip a render.
 */
export function mergeServer(list: readonly DiscoveredServer[], incoming: DiscoveredServer): DiscoveredServer[] {
  const key = idKey(incoming.id);
  const i = list.findIndex((s) => idKey(s.id) === key);
  if (i < 0) return [...list, incoming];
  const old = list[i];
  const udpWins = incoming.source === 'udp' || old.source !== 'udp';
  const next: DiscoveredServer = {
    id: udpWins ? incoming.id : old.id,
    name: incoming.source === 'udp' && old.source !== 'udp' ? old.name : incoming.name || old.name,
    version: incoming.version ?? old.version,
    address: udpWins ? incoming.address : old.address,
    source: udpWins ? incoming.source : old.source,
  };
  if (next.id === old.id && next.name === old.name && next.version === old.version && next.address === old.address && next.source === old.source) {
    return list as DiscoveredServer[];
  }
  const out = list.slice();
  out[i] = next;
  return out;
}

export function mergeAll(list: readonly DiscoveredServer[], incoming: readonly DiscoveredServer[]): DiscoveredServer[] {
  return incoming.reduce<DiscoveredServer[]>((acc, s) => mergeServer(acc, s), list as DiscoveredServer[]);
}

/** True when a saved server has this Id. */
export function isSaved(server: DiscoveredServer, savedIds: readonly string[]): boolean {
  const key = idKey(server.id);
  return savedIds.some((id) => idKey(id) === key);
}

/** Sorted for the list: not saved first, then by name. */
export function sortForList(list: readonly DiscoveredServer[], savedIds: readonly string[]): DiscoveredServer[] {
  return list
    .slice()
    .sort((a, b) => Number(isSaved(a, savedIds)) - Number(isSaved(b, savedIds)) || a.name.localeCompare(b.name));
}
