import type { DownloadEvent } from '@/platform/desktop';

import { createDesktopEngine, createDesktopFiles, type Invoke } from '../desktop';
import type { EngineHandlers } from '../engine-types';
import { fileUri, localImageUri } from '../local';

function fakeInvoke(results: Record<string, unknown> = {}) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const invoke = jest.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
    return results[cmd];
  }) as unknown as Invoke;
  return { invoke, calls };
}

function handlers(): jest.Mocked<EngineHandlers> {
  return { onBegin: jest.fn(), onProgress: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('desktop download engine', () => {
  it('sends the Rust download events to the manager', () => {
    let emit: (e: DownloadEvent) => void = () => undefined;
    const engine = createDesktopEngine(fakeInvoke().invoke, (l) => {
      emit = l;
      return () => undefined;
    });
    const h = handlers();
    emit({ type: 'progress', id: 'a', done: 1, total: 2 });
    expect(h.onProgress).not.toHaveBeenCalled();
    engine.configure(h, { maxParallel: 2 });
    emit({ type: 'begin', id: 'a', expected: 100 });
    emit({ type: 'progress', id: 'a', done: 50, total: 100 });
    emit({ type: 'done', id: 'a', bytes: 100 });
    emit({ type: 'error', id: 'b', message: 'HTTP 404', code: 404 });
    expect(h.onBegin).toHaveBeenCalledWith('a', 100);
    expect(h.onProgress).toHaveBeenCalledWith('a', 50, 100);
    expect(h.onDone).toHaveBeenCalledWith('a', 100);
    expect(h.onError).toHaveBeenCalledWith('b', 'HTTP 404', 404);
  });

  it('starts, pauses, resumes and stops through the Rust commands', async () => {
    const { invoke, calls } = fakeInvoke();
    const engine = createDesktopEngine(invoke, () => () => undefined);
    engine.start({ id: 'a', url: 'https://s/x', destination: '/data/downloads/a/media.mkv', headers: { Authorization: 'k' } });
    await engine.pause('a');
    await engine.resume('a');
    await engine.stop('a');
    engine.finish('a');
    await flush();
    expect(calls.map((c) => c[0])).toEqual(['download_start', 'download_pause', 'download_resume', 'download_stop', 'download_finish']);
    expect(calls[0][1]).toEqual({ task: { id: 'a', url: 'https://s/x', destination: '/data/downloads/a/media.mkv', headers: { Authorization: 'k' } } });
  });

  it('reports a start that Rust refuses as a download error', async () => {
    const invoke = jest.fn(async () => {
      throw new Error('the destination is outside the app data folder');
    }) as unknown as Invoke;
    const engine = createDesktopEngine(invoke, () => () => undefined);
    const h = handlers();
    engine.configure(h, { maxParallel: 2 });
    engine.start({ id: 'a', url: 'u', destination: '/tmp/x' });
    await flush();
    expect(h.onError).toHaveBeenCalledWith('a', 'the destination is outside the app data folder', 0);
  });

  it('lists the tasks of the last run', async () => {
    const tasks = [
      { id: 'a', state: 'paused', bytesDone: 10, bytesTotal: 100 },
      { id: 'b', state: 'weird', bytesDone: 0, bytesTotal: 0 },
    ];
    const engine = createDesktopEngine(fakeInvoke({ download_existing: tasks }).invoke, () => () => undefined);
    expect(await engine.existing()).toEqual([
      { id: 'a', state: 'paused', bytesDone: 10, bytesTotal: 100 },
      { id: 'b', state: 'other', bytesDone: 0, bytesTotal: 0 },
    ]);
  });
});

describe('desktop download files', () => {
  const pageUrl = (p: string) => `asset://localhost/${encodeURIComponent(p)}`;

  it('gives the page an asset URL and Rust a disk path', () => {
    const f = createDesktopFiles(fakeInvoke().invoke, '/Users/x/Library/Application Support/app', pageUrl);
    expect(f.documentsDir()).toBe('asset://localhost/%2FUsers%2Fx%2FLibrary%2FApplication%20Support%2Fapp');
    expect(f.absolutePath('/downloads/a/media.mkv')).toBe('/Users/x/Library/Application Support/app/downloads/a/media.mkv');
    const docs = f.documentsDir() as string;
    expect(fileUri(docs, 'downloads/a/media.mkv')).toBe(`${docs}/downloads/a/media.mkv`);
    expect(localImageUri({ dir: 'downloads/a', images: { primary: 'primary.jpg' } }, docs, 'poster')).toBe(`${docs}/downloads/a/primary.jpg`);
  });

  it('runs the writes in the order the manager asked for them', async () => {
    const { invoke, calls } = fakeInvoke({ files_list_dirs: ['a', 'orphan'], files_disk_space: { free: 1, total: 2 } });
    const f = createDesktopFiles(invoke, '/data', pageUrl);
    await f.ready;
    calls.length = 0;
    f.ensureDir('downloads/a');
    f.writeText('downloads/a/item.json', '{}');
    f.remove('downloads/a/media.mkv');
    const bytes = f.fetchFile('https://s/img', 'downloads/a/primary.jpg');
    await bytes;
    expect(calls.map((c) => c[0])).toEqual(['files_ensure_dir', 'files_write_text', 'files_remove', 'files_fetch']);
    expect(calls[1][1]).toEqual({ path: 'downloads/a/item.json', text: '{}' });
  });

  it('has the folder list and the disk space after the start', async () => {
    const f = createDesktopFiles(fakeInvoke({ files_list_dirs: ['a', 'b'], files_disk_space: { free: 5, total: 9 } }).invoke, '/data', pageUrl);
    await f.ready;
    expect(f.listDirs('downloads')).toEqual(['a', 'b']);
    expect(f.listDirs('/downloads/collections/')).toEqual(['a', 'b']);
    expect(f.listDirs('other')).toEqual([]);
    expect(f.diskSpace()).toEqual({ free: 5, total: 9 });
  });
});
