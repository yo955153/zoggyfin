/**
 * Downloads in the desktop app (Tauri). The Rust side
 * (`desktop/src-tauri/src/downloads.rs`) moves the bytes: HTTP downloads with
 * resume (Range), pause, cancel and progress events. The records and their
 * state rules stay in the manager, the same as on iPhone.
 *
 * Files are in the app data folder, with the same layout as on iPhone
 * (`downloads/<itemId>/media.<ext>`, `item.json`, images, subtitles). The page
 * reads them through Tauri's asset protocol, so `documentsDir()` is an
 * `asset://` URL and `absolutePath()` is a disk path.
 *
 * The file interface is synchronous (expo-file-system is). Tauri calls are
 * not, so writes run in order in the background, and the few reads that the
 * manager makes come from values that are loaded before it needs them.
 */
import type { DownloadEvent } from '@/platform/desktop';

import type { DownloadEngine, EngineHandlers, ExistingTask } from './engine-types';
import type { DownloadFiles } from './files-types';

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** The engine over the Rust downloader. `subscribe` delivers the Rust download events. */
export function createDesktopEngine(invoke: Invoke, subscribe: (l: (e: DownloadEvent) => void) => () => void): DownloadEngine {
  let handlers: EngineHandlers | null = null;
  subscribe((e) => {
    if (!handlers) return;
    switch (e.type) {
      case 'begin':
        handlers.onBegin(e.id, e.expected);
        break;
      case 'progress':
        handlers.onProgress(e.id, e.done, e.total);
        break;
      case 'done':
        handlers.onDone(e.id, e.bytes);
        break;
      case 'error':
        handlers.onError(e.id, e.message, e.code);
        break;
    }
  });
  const quiet = (p: Promise<unknown>) => p.then(() => undefined).catch((err: unknown) => console.warn('[downloads]', err));
  return {
    supported: true,
    configure(h) {
      // The manager starts at most `maxParallel` downloads; Rust runs what it is given.
      handlers = h;
    },
    start({ id, url, destination, headers }) {
      invoke('download_start', { task: { id, url, destination, headers: headers ?? {} } }).catch((err: unknown) =>
        handlers?.onError(id, err instanceof Error ? err.message : String(err), 0),
      );
    },
    pause: (id) => quiet(invoke('download_pause', { id })),
    resume: (id) => quiet(invoke('download_resume', { id })),
    stop: (id) => quiet(invoke('download_stop', { id })),
    async existing() {
      const tasks = await invoke<ExistingTask[]>('download_existing');
      return tasks.map((t) => ({ ...t, state: t.state === 'done' || t.state === 'downloading' || t.state === 'paused' || t.state === 'failed' ? t.state : 'other' }));
    },
    finish(id) {
      void quiet(invoke('download_finish', { id }));
    },
  };
}

function join(base: string, relative: string): string {
  return `${base.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`;
}

/**
 * The file operations over the Rust commands. `dataDir` is the app data folder
 * (a disk path); `pageUrl` turns it into a URL that the page can load.
 */
export function createDesktopFiles(invoke: Invoke, dataDir: string, pageUrl: (path: string) => string): DownloadFiles & { ready: Promise<void> } {
  /** Writes run one after another, in the order the manager asked for them. */
  let chain: Promise<unknown> = Promise.resolve();
  const queue = (cmd: string, args: Record<string, unknown>) => {
    chain = chain.then(() => invoke(cmd, args)).catch((err: unknown) => console.warn('[downloads]', cmd, err));
  };
  /** Folder lists, loaded at start for the orphan clean-up. */
  const dirs = new Map<string, string[]>();
  let space: { free: number; total: number } | null = null;
  const refreshSpace = () =>
    invoke<{ free: number; total: number } | null>('files_disk_space')
      .then((s) => {
        space = s;
      })
      .catch(() => undefined);
  const ready = Promise.all([
    ...['downloads', 'downloads/collections'].map((d) =>
      invoke<string[]>('files_list_dirs', { path: d })
        .then((list) => void dirs.set(d, list))
        .catch(() => undefined),
    ),
    refreshSpace(),
  ]).then(() => undefined);
  return {
    ready,
    documentsDir: () => pageUrl(dataDir),
    absolutePath: (relative) => join(dataDir, relative),
    ensureDir: (relative) => queue('files_ensure_dir', { path: relative }),
    // Not known without a wait: the manager then uses the byte count of the download.
    exists: () => false,
    size: () => 0,
    remove: (relative) => queue('files_remove', { path: relative }),
    writeText: (relative, text) => queue('files_write_text', { path: relative, text }),
    readText: () => null,
    async readUriText(uri) {
      try {
        const res = await fetch(uri);
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    },
    async fetchFile(url, relative, headers) {
      await chain;
      return invoke<number>('files_fetch', { url, path: relative, headers: headers ?? null });
    },
    diskSpace() {
      void refreshSpace();
      return space;
    },
    listDirs: (relative) => dirs.get(relative.replace(/^\/+|\/+$/g, '')) ?? [],
    // Application Support is not in iCloud; Time Machine may keep it, which is fine.
    excludeFromBackup: () => undefined,
  };
}
