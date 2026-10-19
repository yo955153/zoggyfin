/** Web: downloads are hidden, so there are no files. Native builds use `files.native.ts`. */
import type { DownloadFiles } from './files-types';

export const files: DownloadFiles = {
  documentsDir: () => null,
  absolutePath: (relative) => relative,
  ensureDir: () => undefined,
  exists: () => false,
  size: () => 0,
  remove: () => undefined,
  writeText: () => undefined,
  readText: () => null,
  readUriText: () => null,
  fetchFile: async () => 0,
  diskSpace: () => null,
  listDirs: () => [],
  excludeFromBackup: () => undefined,
};
