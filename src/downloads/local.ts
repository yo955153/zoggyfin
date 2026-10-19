/**
 * Local-first media choice. Pure: the players ask this before they build a
 * server URL, so a downloaded item plays from the device even when the
 * server is reachable (faster, no data use) and when it is not.
 */
import type { DownloadRecord } from './types';

/** Joins the document directory and a relative path into a file:// URI. */
export function fileUri(documentsDir: string, relative: string): string {
  const base = documentsDir.replace(/^file:\/\//, '').replace(/\/+$/, '');
  const rel = relative.replace(/^\/+/, '');
  return `file://${base}/${rel}`;
}

/** The local file of a completed download, or null. */
export function localMediaUri(record: DownloadRecord | null | undefined, documentsDir: string | null): string | null {
  if (!record || !documentsDir || record.state !== 'completed' || !record.mediaFile) return null;
  return fileUri(documentsDir, `${record.dir}/${record.mediaFile}`);
}

export type MediaChoice = { kind: 'local'; uri: string; record: DownloadRecord } | { kind: 'remote'; uri: string };

/**
 * The URI to play: the local file when the item is downloaded on this
 * device for this server, else the server URL. `remote` runs only when it is
 * needed, so an offline device never builds (or waits for) a server URL.
 */
export function chooseMedia(
  record: DownloadRecord | null | undefined,
  documentsDir: string | null,
  serverId: string | null,
  remote: () => string,
): MediaChoice {
  const local = record && (!serverId || !record.serverId || record.serverId === serverId) ? localMediaUri(record, documentsDir) : null;
  if (local && record) return { kind: 'local', uri: local, record };
  return { kind: 'remote', uri: remote() };
}

/** A local image of a downloaded item for a tile variant, or null. */
export function localImageUri(
  record: Pick<DownloadRecord, 'dir' | 'images'> | null | undefined,
  documentsDir: string | null,
  variant: 'poster' | 'landscape' | 'square' | 'backdrop',
): string | null {
  if (!record || !documentsDir) return null;
  const { primary, backdrop } = record.images;
  const file = variant === 'backdrop' ? (backdrop ?? primary) : (primary ?? backdrop);
  return file ? fileUri(documentsDir, `${record.dir}/${file}`) : null;
}
