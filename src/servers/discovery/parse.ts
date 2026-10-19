import type { DiscoveredServer } from './types';

/** Removes a trailing slash and checks the scheme. Null when the text is not an http(s) URL. */
export function cleanAddress(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#]+(:\d+)?(\/[^\s?#]*)?$/i.test(t)) return null;
  return t;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Reads one answer to `who is JellyfinServer?`:
 * `{"Address":"http://192.0.2.10:8096","Id":"…","Name":"…","EndpointAddress":null}`.
 * Null for anything that is not a valid answer.
 */
export function parseUdpAnswer(payload: string | Record<string, unknown> | null | undefined): DiscoveredServer | null {
  let data: unknown = payload;
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const id = str(o.Id);
  const address = cleanAddress(o.Address);
  if (!id || !address) return null;
  return { id, name: str(o.Name) ?? 'Jellyfin', version: null, address, source: 'udp' };
}

/**
 * Reads `/System/Info/Public` from `url`. Only an answer that looks like
 * Jellyfin counts: `ProductName` "Jellyfin Server" and an `Id`.
 */
export function parsePublicInfo(url: string, data: unknown): DiscoveredServer | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const address = cleanAddress(url);
  const id = str(o.Id);
  if (!address || !id || o.ProductName !== 'Jellyfin Server') return null;
  return { id, name: str(o.ServerName) ?? 'Jellyfin', version: str(o.Version), address, source: 'scan' };
}
