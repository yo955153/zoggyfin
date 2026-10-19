/**
 * The app-level downloads interface. Phase 4 puts the background downloader
 * behind `index.native.ts`; web keeps this file, where downloads are hidden.
 */
import type { DownloadsController } from './types';

export type { DownloadRecord, DownloadsController, DownloadState } from './types';
export { DOWNLOAD_SCHEMA_VERSION } from './types';

const empty: DownloadsController = { supported: false, inProgress: [], downloaded: [] };

export function useDownloads(): DownloadsController {
  return empty;
}
