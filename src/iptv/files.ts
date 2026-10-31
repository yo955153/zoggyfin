/**
 * IPTV files on the web. The Mac app writes them to its data folder through
 * the Rust file commands. The plain web has no files: a file of up to 2 MB
 * goes to the browser's storage, a larger one stays in memory until the page
 * reloads (then the list loads again from the provider).
 */
import { dataDir, invoke } from '@/platform/desktop';
import { storage } from '@/storage/kv';

import type { IptvFiles } from './files-types';

const desktop: IptvFiles = {
  persistent: true,
  read: (path) => invoke<string | null>('files_read_text', { path }).catch(() => null),
  write: (path, text) => invoke<void>('files_write_text', { path, text }),
  remove: (path) => invoke<void>('files_remove', { path }).catch(() => undefined),
};

/** The most text kept in the browser's storage for one file (localStorage holds about 5 MB in all). */
const WEB_STORAGE_MAX = 2 * 1024 * 1024;
const memory = new Map<string, string>();
const key = (path: string) => `iptvfile.${path}`;

const web: IptvFiles = {
  persistent: false,
  async read(path) {
    return memory.get(path) ?? storage.getString(key(path)) ?? null;
  },
  async write(path, text) {
    memory.set(path, text);
    if (text.length <= WEB_STORAGE_MAX) storage.set(key(path), text);
    else storage.remove(key(path));
  },
  async remove(path) {
    for (const p of [...memory.keys()]) {
      if (p === path || p.startsWith(`${path}/`)) {
        memory.delete(p);
        storage.remove(key(p));
      }
    }
    storage.remove(key(path));
    for (const name of ['channels.json', 'guide.json', 'names.json']) storage.remove(key(`${path}/${name}`));
  },
};

export const iptvFiles: IptvFiles = dataDir ? desktop : web;
