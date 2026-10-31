import { initialUpdateState, isNewerOffer, laterKey, retryAction, type UpdateEvent, updateReducer, type UpdateOffer, type UpdateState } from '../machine';
import { createTvUpdates } from '../tv';
import { parseTvFeed, TV_FEED_URL, tvApkName, tvFeedUrl, tvOffer } from '../tv-feed';

jest.mock('@/native/app-updater', () => ({ appUpdater: null }));

const FEED = 'https://releases.example.com/zoggyfin/android-tv/latest.json';
const SHA = 'a'.repeat(64);
const feed = (over: Record<string, unknown> = {}) => ({
  versionName: '0.2.0',
  versionCode: 12,
  url: 'https://releases.example.com/zoggyfin/android-tv/zoggyfin-tv-0.2.0-12.apk',
  sha256: SHA,
  size: 48_000_000,
  notes: '- Faster start\n- A fix',
  pub_date: '2026-10-23T10:00:00Z',
  ...over,
});

describe('parseTvFeed', () => {
  it('reads a full feed', () => {
    expect(parseTvFeed(feed({ minVersionCode: 10 }), FEED)).toEqual({
      versionName: '0.2.0',
      versionCode: 12,
      url: 'https://releases.example.com/zoggyfin/android-tv/zoggyfin-tv-0.2.0-12.apk',
      sha256: SHA,
      size: 48_000_000,
      notes: '- Faster start\n- A fix',
      date: '2026-10-23T10:00:00Z',
      minVersionCode: 10,
    });
  });

  it('reads a relative URL against the feed and lowers the checksum', () => {
    const r = parseTvFeed(feed({ url: 'zoggyfin-tv-0.2.0-12.apk', sha256: 'A'.repeat(64), notes: undefined }), FEED);
    expect(r.url).toBe('https://releases.example.com/zoggyfin/android-tv/zoggyfin-tv-0.2.0-12.apk');
    expect(r.sha256).toBe(SHA);
    expect(r.notes).toBeNull();
    expect(r.minVersionCode).toBeNull();
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['a bad version', feed({ versionName: '0.2' })],
    ['a build number of 0', feed({ versionCode: 0 })],
    ['a text build number', feed({ versionCode: '12' })],
    ['no URL', feed({ url: '' })],
    ['an HTTP URL', feed({ url: 'http://releases.example.com/a.apk' })],
    ['a short checksum', feed({ sha256: 'abc' })],
    ['no size', feed({ size: undefined })],
    ['a bad minVersionCode', feed({ minVersionCode: -1 })],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseTvFeed(raw, FEED)).toThrow(Error);
  });
});

describe('tv feed helpers', () => {
  it('uses the build override only when it is HTTPS', () => {
    expect(tvFeedUrl(undefined)).toBe(TV_FEED_URL);
    expect(tvFeedUrl('  ')).toBe(TV_FEED_URL);
    expect(tvFeedUrl('http://x/latest.json')).toBe(TV_FEED_URL);
    expect(tvFeedUrl('https://x/android-tv-test/latest.json')).toBe('https://x/android-tv-test/latest.json');
  });

  it('makes the offer with the build number and the required flag', () => {
    const r = parseTvFeed(feed({ minVersionCode: 10 }), FEED);
    expect(tvOffer(r, 9)).toEqual({ version: '0.2.0', notes: ['Faster start', 'A fix'], date: '2026-10-23T10:00:00Z', build: 12, required: true });
    expect(tvOffer(r, 10).required).toBe(false);
    expect(tvOffer(parseTvFeed(feed(), FEED), 1).required).toBe(false);
  });

  it('names the file per build', () => {
    expect(tvApkName({ versionName: '0.2.0', versionCode: 12 })).toBe('zoggyfin-tv-0.2.0-12.apk');
    expect(tvApkName({ versionName: '1.0.0-beta+x/y', versionCode: 3 })).toBe('zoggyfin-tv-1.0.0-beta_x_y-3.apk');
  });
});

const tvOfferOf = (version: string, build: number, required = false): UpdateOffer => ({ version, notes: [], date: null, build, required });
const run = (state: UpdateState, ...events: UpdateEvent[]) => events.reduce(updateReducer, state);

describe('updateReducer on Android TV', () => {
  const start = initialUpdateState('0.2.0', null, 12);

  it('compares build numbers, not version names', () => {
    expect(isNewerOffer(tvOfferOf('0.2.0', 13), start)).toBe(true);
    expect(isNewerOffer(tvOfferOf('0.3.0', 12), start)).toBe(false);
    expect(isNewerOffer({ version: '0.2.1', notes: [], date: null }, start)).toBe(true);
    const same = run(start, { type: 'check', manual: true }, { type: 'found', offer: tvOfferOf('0.2.0', 12), at: 1 });
    expect(same.phase.kind).toBe('current');
    const newer = run(start, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.0', 13), at: 1 });
    expect(newer).toMatchObject({ phase: { kind: 'available' }, open: true });
  });

  it('keeps "Later" per build; a new build of the same version opens the card', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.1', 13), at: 1 });
    const later = updateReducer(found, { type: 'later' });
    expect(later.later).toBe('0.2.1+13');
    expect(laterKey(tvOfferOf('0.2.1', 13))).toBe('0.2.1+13');
    expect(run(later, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.1', 13), at: 2 }).open).toBe(false);
    expect(run(later, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.1', 14), at: 3 }).open).toBe(true);
  });

  it('opens a required update even after "Later"', () => {
    const s = { ...start, later: '0.2.1+13' };
    expect(run(s, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.1', 13, true), at: 1 }).open).toBe(true);
  });

  it('waits for the install permission, then installs again', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.1', 13), at: 1 });
    const waiting = run(found, { type: 'install' }, { type: 'downloaded' }, { type: 'needs-permission' });
    expect(waiting).toMatchObject({ phase: { kind: 'permission' }, open: true });
    // An automatic check does not take over; "Install" (back from Settings) downloads again.
    expect(updateReducer(waiting, { type: 'check', manual: false })).toBe(waiting);
    expect(updateReducer(waiting, { type: 'install' }).phase.kind).toBe('downloading');
    expect(run(waiting, { type: 'later' })).toMatchObject({ phase: { kind: 'available' }, open: false, later: '0.2.1+13' });
    // needs-permission only comes from the install step.
    expect(updateReducer(found, { type: 'needs-permission' })).toBe(found);
  });

  it('goes back to "available" when the system installer closes with no install', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.1', 13), at: 1 });
    const installing = run(found, { type: 'install' }, { type: 'downloaded' });
    expect(updateReducer(installing, { type: 'installer-closed' })).toMatchObject({ phase: { kind: 'available' }, open: true });
    expect(updateReducer(found, { type: 'installer-closed' })).toBe(found);
  });

  it('retries a failed checksum with a new download', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: tvOfferOf('0.2.1', 13), at: 1 });
    const failed = run(found, { type: 'install' }, { type: 'failed', message: 'The file is damaged.' });
    expect(failed.phase).toEqual({ kind: 'error', step: 'download', message: 'The file is damaged.' });
    expect(retryAction(failed)).toBe('install');
  });
});

describe('createTvUpdates', () => {
  const native = (canInstall: boolean) => ({
    versionCode: 12,
    versionName: '0.2.0',
    canInstall: jest.fn(() => canInstall),
    download: jest.fn(async (_r: unknown, name: string, onProgress: (d: number, t: number) => void) => {
      onProgress(10, 10);
      return `/cache/updates/${name}`;
    }),
    openInstallSettings: jest.fn(() => 'app' as const),
    install: jest.fn(),
  });
  const ok = (body: unknown) => jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

  it('checks the feed and installs the checked file', async () => {
    const n = native(true);
    const fetcher = ok(feed({ versionCode: 13 }));
    const tv = createTvUpdates(n, FEED, fetcher);
    expect(await tv.check()).toMatchObject({ version: '0.2.0', build: 13 });
    expect(fetcher).toHaveBeenCalledWith(FEED, expect.objectContaining({ headers: { 'Cache-Control': 'no-cache' } }));
    const progress = jest.fn();
    const downloaded = jest.fn();
    expect(await tv.install(progress, downloaded)).toBe('installer');
    expect(n.download).toHaveBeenCalledWith(expect.objectContaining({ sha256: SHA, size: 48_000_000 }), 'zoggyfin-tv-0.2.0-13.apk', progress);
    expect(downloaded).toHaveBeenCalled();
    expect(n.install).toHaveBeenCalledWith('/cache/updates/zoggyfin-tv-0.2.0-13.apk');
  });

  it('opens the settings page when the app may not install apps', async () => {
    const n = native(false);
    const tv = createTvUpdates(n, FEED, ok(feed({ versionCode: 13 })));
    await tv.check();
    expect(await tv.install(jest.fn(), jest.fn())).toBe('permission');
    expect(n.openInstallSettings).toHaveBeenCalled();
    expect(n.install).not.toHaveBeenCalled();
  });

  it('reports a server error and a bad feed', async () => {
    const down = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(createTvUpdates(native(true), FEED, down).check()).rejects.toThrow('The update server answered 404.');
    await expect(createTvUpdates(native(true), FEED, ok({ nope: 1 })).check()).rejects.toThrow('The update feed has no valid version.');
  });
});
