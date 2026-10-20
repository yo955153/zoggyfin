const mockModules: Record<string, unknown> = {};

jest.mock('expo', () => ({ requireOptionalNativeModule: (name: string) => mockModules[name] ?? null }));

describe('makeSeekableMp4', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockModules)) delete mockModules[k];
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const load = () => require('../zoggyfin-native') as typeof import('../zoggyfin-native.native');

  it('uses the iOS module (AVFoundation) when there is no Android module', async () => {
    const fn = jest.fn(() => Promise.resolve('done'));
    mockModules.ZoggyfinNative = { isHardwareDecodeSupported: () => true, makeSeekableMp4: fn };
    await expect(load().makeSeekableMp4('/d/film.mp4')).resolves.toBe('done');
    expect(fn).toHaveBeenCalledWith('/d/film.mp4');
  });

  it('uses the Android module (MediaMuxer) there', async () => {
    mockModules.ZoggyfinAndroid = { decoders: () => ({}), setAutoPictureInPicture: () => undefined, makeSeekableMp4: () => Promise.resolve('skipped') };
    await expect(load().makeSeekableMp4('/d/film.mp4')).resolves.toBe('skipped');
  });

  it('skips in an older build with no function, and reports a failure', async () => {
    mockModules.ZoggyfinNative = { isHardwareDecodeSupported: () => true };
    await expect(load().makeSeekableMp4('/d/film.mp4')).resolves.toBe('skipped');
    mockModules.ZoggyfinNative = { isHardwareDecodeSupported: () => true, makeSeekableMp4: () => Promise.reject(new Error('x')) };
    jest.resetModules();
    await expect(load().makeSeekableMp4('/d/film.mp4')).resolves.toBe('failed');
  });
});
