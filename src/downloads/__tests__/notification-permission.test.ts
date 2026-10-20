import { askForDownloadNotifications, type PermissionDeps } from '../notification-permission';

jest.mock('@/storage/kv', () => ({ storage: { getString: () => undefined, set: () => undefined } }));

function deps(over: Partial<PermissionDeps> = {}) {
  const calls: string[] = [];
  let asked = false;
  const d: PermissionDeps = {
    os: 'android',
    version: 35,
    asked: () => asked,
    markAsked: () => {
      asked = true;
      calls.push('mark');
    },
    granted: async () => false,
    explain: async () => {
      calls.push('explain');
      return true;
    },
    request: async () => {
      calls.push('request');
      return true;
    },
    ...over,
  };
  return { d, calls };
}

describe('the notification permission for downloads', () => {
  it('asks once on Android 13 and later, with the reason first', async () => {
    const { d, calls } = deps();
    await askForDownloadNotifications(d);
    await askForDownloadNotifications(d);
    expect(calls).toEqual(['mark', 'explain', 'request']);
  });

  it('does not ask on Android 12 and earlier, on iOS, or when it is granted', async () => {
    for (const over of [{ version: 28 }, { version: 32 }, { os: 'ios' }, { granted: async () => true }]) {
      const { d, calls } = deps(over);
      await askForDownloadNotifications(d);
      expect(calls.filter((c) => c !== 'mark')).toEqual([]);
    }
  });

  it('a "Not now" or an error changes nothing for the download', async () => {
    const { d, calls } = deps({ explain: async () => false });
    await askForDownloadNotifications(d);
    expect(calls).toEqual(['mark']);
    await expect(askForDownloadNotifications(deps({ granted: () => Promise.reject(new Error('x')) }).d)).resolves.toBeUndefined();
  });
});
