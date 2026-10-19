/**
 * Builds the `Authorization` header that Jellyfin expects.
 *
 * Jellyfin 12 turns off the legacy `X-Emby-*` headers and the `api_key`
 * query parameter, so every request carries this header. URLs that cannot
 * carry a header (images, media streams) use `ApiKey=<token>` instead, see
 * `withApiKey`.
 */

export interface ClientIdentity {
  /** The client name, for example "Zoggyfin". */
  client: string;
  /** A human readable device name, for example "iPhone". */
  device: string;
  /** A stable ID for this install. */
  deviceId: string;
  /** The app version. */
  version: string;
}

/** Values are URI-encoded, the same as the official SDK, so quotes and commas cannot break the header. */
function quote(value: string): string {
  return `"${encodeURIComponent(value)}"`;
}

export function buildAuthHeader(identity: ClientIdentity, token?: string | null): string {
  const parts = [
    `Client=${quote(identity.client)}`,
    `Device=${quote(identity.device)}`,
    `DeviceId=${quote(identity.deviceId)}`,
    `Version=${quote(identity.version)}`,
  ];
  if (token) parts.push(`Token=${quote(token)}`);
  return `MediaBrowser ${parts.join(', ')}`;
}

/** Adds `ApiKey=<token>` to a URL. Jellyfin 12 only accepts this casing. */
export function withApiKey(url: string, token: string | null | undefined): string {
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}ApiKey=${encodeURIComponent(token)}`;
}
