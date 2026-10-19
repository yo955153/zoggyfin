import { withApiKey } from '@/api/auth-header';

export type JellyfinImageType =
  | 'Primary'
  | 'Thumb'
  | 'Backdrop'
  | 'Logo'
  | 'Banner'
  | 'Art'
  | 'Chapter';

export interface ServerContext {
  /** Normalized server base URL, without a trailing slash. */
  baseUrl: string;
  /** The access token. Images carry it as `ApiKey=` because image views cannot send headers. */
  token: string | null;
  /** The server Id. It names cached images, so a switch to another address of the server keeps them. */
  serverId?: string;
}

/**
 * The disk cache key of a server image: the server Id and the path and query
 * without the host and without `ApiKey`. The same image through the internal
 * or the external address (or for another user) is one cache entry.
 * Undefined for URLs that are not on the server (local files).
 */
export function imageCacheKey(uri: string, server: Pick<ServerContext, 'baseUrl' | 'serverId'> | null | undefined): string | undefined {
  if (!server || !uri.startsWith(`${server.baseUrl}/`)) return undefined;
  const rest = uri
    .slice(server.baseUrl.length)
    .replace(/([?&])ApiKey=[^&]*&?/, '$1')
    .replace(/[?&]$/, '');
  return `${server.serverId ?? 'jellyfin'}:${rest}`;
}

/** An expo-image source with the stable cache key. */
export function imageSource(uri: string, server: Pick<ServerContext, 'baseUrl' | 'serverId'> | null | undefined): { uri: string; cacheKey?: string } {
  const cacheKey = imageCacheKey(uri, server);
  return cacheKey ? { uri, cacheKey } : { uri };
}

export interface ImageRequest {
  itemId: string;
  type: JellyfinImageType;
  /** The image tag. Required: we never request an image the server did not announce. */
  tag: string;
  /** Index for Backdrop and Chapter images. */
  index?: number;
  /** Target size in physical pixels. */
  width: number;
  height?: number;
  quality?: number;
}

/** Sizes are rounded up to a step, so near-equal tiles share one cached image. */
const SIZE_STEP = 40;
const MAX_SIZE = 3840;

export function bucketSize(px: number): number {
  if (!Number.isFinite(px) || px <= 0) return SIZE_STEP;
  return Math.min(MAX_SIZE, Math.ceil(px / SIZE_STEP) * SIZE_STEP);
}

export function buildImageUrl(server: ServerContext, req: ImageRequest): string {
  const path =
    req.index !== undefined && (req.type === 'Backdrop' || req.type === 'Chapter')
      ? `/Items/${encodeURIComponent(req.itemId)}/Images/${req.type}/${req.index}`
      : `/Items/${encodeURIComponent(req.itemId)}/Images/${req.type}`;

  const params = [`tag=${encodeURIComponent(req.tag)}`, `fillWidth=${bucketSize(req.width)}`];
  if (req.height !== undefined) params.push(`fillHeight=${bucketSize(req.height)}`);
  params.push(`quality=${req.quality ?? 90}`);

  return withApiKey(`${server.baseUrl}${path}?${params.join('&')}`, server.token);
}

export interface TrickplayTileRequest {
  itemId: string;
  mediaSourceId: string;
  /** The trickplay resolution width, as a key of `item.Trickplay[mediaSourceId]`. */
  width: number;
  /** Index of the tile sheet. */
  sheet: number;
}

export function buildTrickplayUrl(server: ServerContext, req: TrickplayTileRequest): string {
  const url =
    `${server.baseUrl}/Videos/${encodeURIComponent(req.itemId)}/Trickplay/${req.width}/${req.sheet}.jpg` +
    `?mediaSourceId=${encodeURIComponent(req.mediaSourceId)}`;
  return withApiKey(url, server.token);
}

export function buildUserImageUrl(
  server: ServerContext,
  userId: string,
  tag: string,
  sizePx: number,
): string {
  const url =
    `${server.baseUrl}/Users/${encodeURIComponent(userId)}/Images/Primary` +
    `?tag=${encodeURIComponent(tag)}&fillWidth=${bucketSize(sizePx)}&fillHeight=${bucketSize(sizePx)}&quality=90`;
  return withApiKey(url, server.token);
}
