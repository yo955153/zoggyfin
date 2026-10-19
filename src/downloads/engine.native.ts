/**
 * The download engine on iOS and Android: @kesha-antonov/react-native-background-downloader
 * (a background NSURLSession on iOS). Downloads go on while the app is in
 * the background, and the system keeps them when it ends the app.
 */
import {
  type DownloadTask,
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
} from '@kesha-antonov/react-native-background-downloader';
import { Platform } from 'react-native';

import type { DownloadEngine, EngineHandlers, ExistingTask } from './engine-types';

let handlers: EngineHandlers | null = null;
const tasks = new Map<string, DownloadTask>();

function bind(task: DownloadTask): DownloadTask {
  tasks.set(task.id, task);
  return task
    .begin(({ expectedBytes }) => handlers?.onBegin(task.id, expectedBytes))
    .progress(({ bytesDownloaded, bytesTotal }) => handlers?.onProgress(task.id, bytesDownloaded, bytesTotal))
    .done(({ bytesDownloaded }) => {
      tasks.delete(task.id);
      handlers?.onDone(task.id, bytesDownloaded);
    })
    .error(({ error, errorCode }) => {
      tasks.delete(task.id);
      handlers?.onError(task.id, error, errorCode);
    });
}

function stateOf(t: DownloadTask): ExistingTask['state'] {
  switch (t.state) {
    case 'DOWNLOADING':
    case 'PENDING':
      return 'downloading';
    case 'PAUSED':
      return 'paused';
    case 'DONE':
      return 'done';
    case 'FAILED':
      return 'failed';
    default:
      return 'other';
  }
}

export const engine: DownloadEngine = {
  supported: !Platform.isTV,
  configure(h, opts) {
    handlers = h;
    setConfig({
      progressInterval: 1000,
      progressMinBytes: 256 * 1024,
      maxParallelDownloads: opts.maxParallel,
      isLogsEnabled: false,
    });
  },
  start({ id, url, destination, headers }) {
    const task = createDownloadTask({ id, url, destination, headers, metadata: {} });
    bind(task).start();
  },
  async pause(id) {
    await tasks.get(id)?.pause();
  },
  async resume(id) {
    await tasks.get(id)?.resume();
  },
  async stop(id) {
    const t = tasks.get(id);
    tasks.delete(id);
    await t?.stop();
  },
  async existing() {
    const found = await getExistingDownloadTasks();
    return found.map((t) => {
      bind(t);
      return { id: t.id, state: stateOf(t), bytesDone: t.bytesDownloaded, bytesTotal: t.bytesTotal };
    });
  },
  finish(id) {
    try {
      completeHandler(id);
    } catch {
      // Nothing to release.
    }
  },
};
