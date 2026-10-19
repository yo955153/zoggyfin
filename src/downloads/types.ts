/** Download records are versioned from day one, so later migrations are safe. */
export const DOWNLOAD_SCHEMA_VERSION = 1;

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'failed' | 'done';

export interface DownloadRecord {
  schemaVersion: typeof DOWNLOAD_SCHEMA_VERSION;
  itemId: string;
  serverId: string;
  title: string;
  state: DownloadState;
  bytesTotal: number | null;
  bytesDone: number;
  localPath: string | null;
  createdAt: string;
}

export interface DownloadsController {
  /** False until the downloader ships (phase 4), and always false on web. */
  readonly supported: boolean;
  inProgress: DownloadRecord[];
  downloaded: DownloadRecord[];
}
