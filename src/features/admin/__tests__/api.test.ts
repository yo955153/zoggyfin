/**
 * The SDK adapter against mocked server answers: an axios adapter records
 * each request and returns a canned response, so no request leaves the test.
 */
import { Jellyfin } from '@jellyfin/sdk';
import { type AxiosAdapter, type InternalAxiosRequestConfig, create } from 'axios';

import { sdkAdminApi } from '../api';
import { fixtureAdminApi } from '../fixtures';

type Canned = { status?: number; data?: unknown; headers?: Record<string, string> };

function mockServer(routes: Record<string, Canned>) {
  const calls: { method: string; url: string; params?: unknown; data?: unknown; headers: Record<string, unknown> }[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const url = new URL(config.url ?? '', 'http://x');
    const path = url.pathname.replace(/^\/jf/, '');
    const method = (config.method ?? 'get').toUpperCase();
    calls.push({ method, url: `${path}${url.search}`, params: config.params, data: config.data ? JSON.parse(config.data as string) : undefined, headers: { ...config.headers } });
    const r = routes[`${method} ${path}`] ?? { status: 404 };
    const status = r.status ?? 200;
    const res = { data: r.data ?? '', status, statusText: String(status), headers: r.headers ?? {}, config };
    if (status >= 400) throw Object.assign(new Error(`HTTP ${status}`), { response: res, isAxiosError: true });
    return res;
  };
  const sdk = new Jellyfin({ clientInfo: { name: 'Test', version: '1' }, deviceInfo: { id: 'dev', name: 'Test' } });
  const api = sdk.createApi('http://server.test/jf', 'token', create({ adapter }));
  return { admin: sdkAdminApi(api), calls };
}

describe('sdkAdminApi', () => {
  it('saves the whole policy of a user', async () => {
    const { admin, calls } = mockServer({ 'POST /Users/u1/Policy': { status: 204 } });
    await admin.updatePolicy('u1', { EnableContentDownloading: false, AuthenticationProviderId: 'a', PasswordResetProviderId: 'r' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/Users/u1/Policy', data: { EnableContentDownloading: false, AuthenticationProviderId: 'a', PasswordResetProviderId: 'r' } });
  });

  it('sets and removes a password', async () => {
    const { admin, calls } = mockServer({ 'POST /Users/Password': { status: 204 } });
    await admin.setPassword('u1', 'new-secret');
    await admin.removePassword('u1');
    expect(calls[0].url).toBe('/Users/Password?userId=u1');
    expect(calls[0].data).toEqual({ CurrentPw: '', NewPw: 'new-secret', ResetPassword: false });
    expect(calls[1].data).toEqual({ ResetPassword: true });
  });

  it('starts a library scan with the right refresh modes', async () => {
    const { admin, calls } = mockServer({ 'POST /Items/lib1/Refresh': { status: 204 } });
    await admin.refreshLibrary('lib1', 'scan');
    await admin.refreshLibrary('lib1', 'missing');
    await admin.refreshLibrary('lib1', 'replace');
    expect(calls.map((c) => c.url)).toEqual([
      '/Items/lib1/Refresh?metadataRefreshMode=Default&imageRefreshMode=Default&replaceAllMetadata=false&replaceAllImages=false',
      '/Items/lib1/Refresh?metadataRefreshMode=FullRefresh&imageRefreshMode=FullRefresh&replaceAllMetadata=false&replaceAllImages=false',
      '/Items/lib1/Refresh?metadataRefreshMode=FullRefresh&imageRefreshMode=FullRefresh&replaceAllMetadata=true&replaceAllImages=true',
    ]);
  });

  it('turns the file watch of a library on and keeps its other options', async () => {
    const { admin, calls } = mockServer({
      'GET /Library/VirtualFolders': { data: [{ Name: 'Shows', ItemId: 'lib1', LibraryOptions: { EnableRealtimeMonitor: false, EnablePhotos: true } }] },
      'POST /Library/VirtualFolders/LibraryOptions': { status: 204 },
    });
    await admin.setLibraryWatch('lib1', true);
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/Library/VirtualFolders/LibraryOptions', data: { Id: 'lib1', LibraryOptions: { EnableRealtimeMonitor: true, EnablePhotos: true } } });
  });

  it('refuses to change the file watch of a library that is gone', async () => {
    const { admin, calls } = mockServer({ 'GET /Library/VirtualFolders': { data: [] } });
    await expect(admin.setLibraryWatch('lib1', true)).rejects.toThrow('no longer on the server');
    expect(calls).toHaveLength(1);
  });

  it('sends session commands', async () => {
    const { admin, calls } = mockServer({
      'POST /Sessions/s1/Message': { status: 204 },
      'POST /Sessions/s1/Playing/Pause': { status: 204 },
      'POST /Sessions/s1/Playing/Stop': { status: 204 },
    });
    await admin.sendMessage('s1', 'Hello');
    await admin.playstate('s1', 'Pause');
    expect(calls[0].data).toMatchObject({ Text: 'Hello' });
    expect(calls[1].url).toBe('/Sessions/s1/Playing/Pause');
    // No play session Id: "Stop transcode" stops the playback.
    await expect(admin.stopTranscode({ Id: 's1', DeviceId: 'd1', PlayState: {} })).resolves.toBe('stopped');
    expect(calls[2].url).toBe('/Sessions/s1/Playing/Stop');
  });

  it('ends the transcode job directly when the play session Id is known', async () => {
    const { admin, calls } = mockServer({ 'DELETE /Videos/ActiveEncodings': { status: 204 } });
    const s = { Id: 's1', DeviceId: 'd1', PlayState: { PlaySessionId: 'p1' } as object };
    await expect(admin.stopTranscode(s)).resolves.toBe('killed');
    expect(calls[0]).toMatchObject({ method: 'DELETE', params: { deviceId: 'd1', playSessionId: 'p1' } });
  });

  it('pages the activity log', async () => {
    const { admin, calls } = mockServer({ 'GET /System/ActivityLog/Entries': { data: { Items: [{ Id: 1 }, { Id: 2 }], TotalRecordCount: 7 } } });
    await expect(admin.activity(50, 2)).resolves.toEqual({ items: [{ Id: 1 }, { Id: 2 }], startIndex: 50, count: 2, total: 7 });
    expect(calls[0].url).toBe('/System/ActivityLog/Entries?startIndex=50&limit=2');
  });

  it('removes one device by Id', async () => {
    const { admin, calls } = mockServer({ 'DELETE /Devices': { status: 204 } });
    await admin.deleteDevice('d1');
    expect(calls[0]).toMatchObject({ method: 'DELETE', params: { id: 'd1' } });
  });

  it('loads a log file in byte ranges', async () => {
    const { admin, calls } = mockServer({ 'GET /System/Logs/Log': { status: 206, data: 'line 1\nline', headers: { 'content-range': 'bytes 0-10/30' } } });
    await expect(admin.logChunk('log.txt', 0, 10)).resolves.toEqual({ text: 'line 1\nline', total: 30, done: false, bytes: 11 });
    expect(calls[0].headers.Range).toBe('bytes=0-10');
    expect(calls[0].params).toEqual({ name: 'log.txt' });
  });

  it('takes a whole log file when the server ignores the range', async () => {
    const { admin } = mockServer({ 'GET /System/Logs/Log': { status: 200, data: 'all\n' } });
    await expect(admin.logChunk('log.txt', 0, 10)).resolves.toEqual({ text: 'all\n', total: 4, done: true, bytes: 4 });
  });

  it('gives null storage on a server with no storage endpoint', async () => {
    const { admin } = mockServer({});
    await expect(admin.storage()).resolves.toBeNull();
  });

  it('passes a 403 on', async () => {
    const { admin } = mockServer({ 'GET /ScheduledTasks': { status: 403 } });
    await expect(admin.tasks()).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe('fixtureAdminApi', () => {
  it('runs a task to the end and records the result', async () => {
    jest.useFakeTimers();
    const api = fixtureAdminApi();
    const run = async <T>(p: Promise<T>) => {
      const r = p;
      await jest.runAllTimersAsync();
      return r;
    };
    await run(api.startTask('CleanLogs'));
    let task = (await run(api.tasks())).find((t) => t.Id === 'CleanLogs');
    expect(task?.State).toBe('Running');
    for (let i = 0; i < 12; i++) task = (await run(api.tasks())).find((t) => t.Id === 'CleanLogs');
    expect(task?.State).toBe('Idle');
    expect(task?.LastExecutionResult?.Status).toBe('Completed');
    jest.useRealTimers();
  });
});
