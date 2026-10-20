import { downloadManager, offerDownloadAgain } from '../manager';
import { FILE_MISSING, isFileMissing, transition } from '../state-machine';
import { putRecord, recordStatus, useDownloadsStore } from '../store';
import { rec } from '../test-utils/fixtures';

jest.mock('@/storage/kv', () => {
  const m = new Map<string, string>();
  return { storage: { getString: (k: string) => m.get(k), set: (k: string, v: string) => m.set(k, v), remove: (k: string) => m.delete(k), clearAll: () => m.clear() } };
});

/** Sizes of the files on the fake disk, by relative path. */
const mockSizes: Record<string, number> = {};

jest.mock('../files', () => ({
  files: {
    statSize: async (relative: string) => mockSizes[relative] ?? 0,
    size: (relative: string) => mockSizes[relative] ?? 0,
  },
}));

jest.mock('../engine', () => ({ engine: { supported: true } }));

const mockToast = jest.fn();
jest.mock('@/lib/toast', () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

const done = (over: Parameters<typeof rec>[0]) => rec({ state: 'completed', mediaFile: 'media.mkv', bytesDone: 100, bytesTotal: 100, completedAt: 5, ...over });

beforeEach(() => {
  useDownloadsStore.setState({ records: {}, collections: {} });
  for (const k of Object.keys(mockSizes)) delete mockSizes[k];
  mockToast.mockClear();
});

describe('missing download files', () => {
  it('turns a completed download with no file into one to download again', () => {
    const r = transition(done({}), { type: 'missing' });
    expect(r.state).toBe('failed');
    expect(r.error).toBe(FILE_MISSING);
    expect(r.retryAt).toBeNull();
    expect(r.bytesDone).toBe(0);
    expect(r.completedAt).toBeNull();
    expect(isFileMissing(r)).toBe(true);
    expect(recordStatus(r)).toEqual({ state: 'failed', progress: 0, missing: true });
    // A retry downloads it again.
    expect(transition(r, { type: 'retry' }).state).toBe('queued');
    // Only a completed download can lose its file.
    const q = rec({ state: 'queued' });
    expect(transition(q, { type: 'missing' })).toBe(q);
  });

  it('marks only the completed downloads whose file is gone', async () => {
    putRecord(done({ itemId: 'here' }));
    putRecord(done({ itemId: 'gone' }));
    putRecord(rec({ itemId: 'queued', state: 'queued', mediaFile: 'media.mkv' }));
    mockSizes['downloads/here/media.mkv'] = 100;
    await expect(downloadManager.checkFiles()).resolves.toEqual(['gone']);
    const { records } = useDownloadsStore.getState();
    expect(records.here.state).toBe('completed');
    expect(isFileMissing(records.gone)).toBe(true);
    expect(records.queued.state).toBe('queued');
    offerDownloadAgain(['gone']);
    expect(mockToast).toHaveBeenCalledWith('Sample Song is no longer on this device', expect.objectContaining({ action: expect.objectContaining({ label: 'Download again' }) }));
  });

  it('checks only the ids it is given, and downloads them again on request', async () => {
    putRecord(done({ itemId: 'a' }));
    putRecord(done({ itemId: 'b' }));
    await expect(downloadManager.checkFiles(['a'])).resolves.toEqual(['a']);
    expect(useDownloadsStore.getState().records.b.state).toBe('completed');
    downloadManager.downloadAgain(['a', 'b']);
    expect(useDownloadsStore.getState().records.a.state).toBe('queued');
    expect(useDownloadsStore.getState().records.b.state).toBe('completed');
  });

  it('keeps the record when the size cannot be read', async () => {
    putRecord(done({ itemId: 'a' }));
    const { files } = jest.requireMock('../files') as { files: { statSize: (p: string) => Promise<number> } };
    const spy = jest.spyOn(files, 'statSize').mockRejectedValueOnce(new Error('no access'));
    await expect(downloadManager.checkFiles()).resolves.toEqual([]);
    expect(useDownloadsStore.getState().records.a.state).toBe('completed');
    spy.mockRestore();
  });
});
