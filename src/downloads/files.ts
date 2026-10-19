/**
 * Web: downloads are hidden, so there are no files. The desktop app (Tauri)
 * has them (`desktop.ts`). Native builds use `files.native.ts`.
 */
import { assetUrl, dataDir, invoke } from '@/platform/desktop';

import { createDesktopFiles } from './desktop';
import type { DownloadFiles } from './files-types';

const none: DownloadFiles = {
  documentsDir: () => null,
  absolutePath: (relative) => relative,
  ensureDir: () => undefined,
  exists: () => false,
  size: () => 0,
  remove: () => undefined,
  writeText: () => undefined,
  readText: () => null,
  readUriText: async () => null,
  fetchFile: async () => 0,
  diskSpace: () => null,
  listDirs: () => [],
  excludeFromBackup: () => undefined,
};

export const files: DownloadFiles = dataDir ? createDesktopFiles(invoke, dataDir, assetUrl) : none;
