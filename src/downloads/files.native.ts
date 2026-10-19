/**
 * Download files on the device, under the app's document directory (not
 * the cache, which the system may empty). Uses expo-file-system.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { excludeFromBackup } from '@/native/zoggyfin-native';

import type { DownloadFiles } from './files-types';

function docs(): string {
  return Paths.document.uri.replace(/\/+$/, '');
}

function uriOf(relative: string): string {
  return `${docs()}/${relative.replace(/^\/+/, '')}`;
}

export const files: DownloadFiles = {
  documentsDir: () => docs(),
  absolutePath: (relative) => decodeURIComponent(uriOf(relative).replace(/^file:\/\//, '')),
  ensureDir(relative) {
    const d = new Directory(uriOf(relative));
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
  },
  exists(relative) {
    try {
      return new File(uriOf(relative)).exists;
    } catch {
      return false;
    }
  },
  size(relative) {
    try {
      const f = new File(uriOf(relative));
      return f.exists ? (f.size ?? 0) : 0;
    } catch {
      return 0;
    }
  },
  remove(relative) {
    try {
      const d = new Directory(uriOf(relative));
      if (d.exists) {
        d.delete();
        return;
      }
    } catch {
      // Not a directory.
    }
    try {
      const f = new File(uriOf(relative));
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  },
  writeText(relative, text) {
    const f = new File(uriOf(relative));
    if (!f.exists) f.create({ intermediates: true, overwrite: true });
    f.write(text);
  },
  readText(relative) {
    try {
      const f = new File(uriOf(relative));
      return f.exists ? f.textSync() : null;
    } catch {
      return null;
    }
  },
  async readUriText(uri) {
    try {
      const f = new File(uri);
      return f.exists ? f.textSync() : null;
    } catch {
      return null;
    }
  },
  async fetchFile(url, relative, headers) {
    const target = new File(uriOf(relative));
    const out = await File.downloadFileAsync(url, target, { headers, idempotent: true });
    return out.size ?? 0;
  },
  diskSpace() {
    try {
      return { free: Paths.availableDiskSpace, total: Paths.totalDiskSpace };
    } catch {
      return null;
    }
  },
  listDirs(relative) {
    try {
      const d = new Directory(uriOf(relative));
      if (!d.exists) return [];
      return d
        .list()
        .filter((e): e is Directory => e instanceof Directory)
        .map((e) => e.name);
    } catch {
      return [];
    }
  },
  excludeFromBackup(relative) {
    excludeFromBackup(files.absolutePath(relative));
  },
};
