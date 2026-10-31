import { isProgressiveTsUrl, TsBridgeError } from '../ts-bridge-types';

const mockModules: Record<string, unknown> = {};

jest.mock('expo', () => ({ requireOptionalNativeModule: (name: string) => mockModules[name] ?? null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = () => require('../ts-bridge.native') as typeof import('../ts-bridge.native');

describe('TsBridgeError', () => {
  it('keeps the code and the HTTP status', () => {
    const e = new TsBridgeError('http', 'x', 404);
    expect(e).toBeInstanceOf(Error);
    expect([e.name, e.code, e.httpStatus]).toEqual(['TsBridgeError', 'http', 404]);
  });
});

describe('isProgressiveTsUrl', () => {
  it('matches http(s) URLs whose path ends in .ts', () => {
    expect(isProgressiveTsUrl('http://iptv.example.com:8080/live/user/pass/123.ts')).toBe(true);
    expect(isProgressiveTsUrl('https://example.com/a/b.TS?token=x')).toBe(true);
  });

  it('does not match HLS, other files or other schemes', () => {
    expect(isProgressiveTsUrl('http://example.com/live/123.m3u8')).toBe(false);
    expect(isProgressiveTsUrl('http://example.com/play?file=123.ts')).toBe(false);
    expect(isProgressiveTsUrl('http://example.com/')).toBe(false);
    expect(isProgressiveTsUrl('file:///tmp/a.ts')).toBe(false);
    expect(isProgressiveTsUrl('rtmp://example.com/a.ts')).toBe(false);
  });
});

describe('tsBridge', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockModules)) delete mockModules[k];
  });

  it('is null in a build without the module (Android, older iOS binaries)', () => {
    expect(load().tsBridge).toBeNull();
  });

  it('is null on the web', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect((require('../ts-bridge.ts') as typeof import('../ts-bridge')).tsBridge).toBeNull();
  });

  it('starts a session and passes the headers and options', async () => {
    const start = jest.fn(() => Promise.resolve({ ok: true, id: 'a1', playlistUrl: 'http://127.0.0.1:5000/t/index.m3u8' }));
    mockModules.ZoggyfinTsBridge = { start, stop: jest.fn(), stopAll: jest.fn(), addListener: jest.fn() };
    const bridge = load().tsBridge!;
    await expect(bridge.start('http://x/1.ts', { 'User-Agent': 'VLC' })).resolves.toEqual({ id: 'a1', playlistUrl: 'http://127.0.0.1:5000/t/index.m3u8' });
    expect(start).toHaveBeenCalledWith('http://x/1.ts', { 'User-Agent': 'VLC' }, {});
  });

  it('turns a failed start into a TsBridgeError with the code', async () => {
    mockModules.ZoggyfinTsBridge = {
      start: () => Promise.resolve({ ok: false, code: 'http', message: 'The stream answered with HTTP 403.', httpStatus: 403 }),
      stop: jest.fn(),
      stopAll: jest.fn(),
      addListener: jest.fn(),
    };
    const err = await load().tsBridge!.start('http://x/1.ts').catch((e: unknown) => e);
    // resetModules loads a second copy of the class, so check the name.
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'TsBridgeError', code: 'http', httpStatus: 403 });
  });

  it('removes a status listener', () => {
    const remove = jest.fn();
    const addListener = jest.fn(() => ({ remove }));
    mockModules.ZoggyfinTsBridge = { start: jest.fn(), stop: jest.fn(), stopAll: jest.fn(), addListener };
    const off = load().tsBridge!.addStatusListener(() => undefined);
    expect(addListener).toHaveBeenCalledWith('onStatus', expect.any(Function));
    off();
    expect(remove).toHaveBeenCalled();
  });
});
