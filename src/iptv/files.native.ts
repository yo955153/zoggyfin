/**
 * IPTV files on iOS and Android: under the documents folder (the system does
 * not empty it like the cache), kept out of iCloud and device backups, since
 * a list can be large and holds stream URLs.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { excludeFromBackup } from '@/native/zoggyfin-native';

import type { IptvFiles } from './files-types';

function uriOf(path: string): string {
  return `${Paths.document.uri.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

let rootReady = false;

function ensureRoot(): void {
  if (rootReady) return;
  const root = new Directory(uriOf('iptv'));
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  try {
    excludeFromBackup(decodeURIComponent(root.uri.replace(/^file:\/\//, '')));
  } catch {
    // Older binaries have no native helper: the folder is backed up.
  }
  rootReady = true;
}

export const iptvFiles: IptvFiles = {
  persistent: true,
  async read(path) {
    try {
      const f = new File(uriOf(path));
      return f.exists ? await f.text() : null;
    } catch {
      return null;
    }
  },
  async write(path, text) {
    ensureRoot();
    const f = new File(uriOf(path));
    if (!f.exists) f.create({ intermediates: true, overwrite: true });
    await f.write(text);
  },
  async remove(path) {
    try {
      const d = new Directory(uriOf(path));
      if (d.exists) {
        d.delete();
        return;
      }
    } catch {
      // Not a folder.
    }
    try {
      const f = new File(uriOf(path));
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  },
};
