/**
 * The IPTV manager with a fake provider, fake mockFiles and a fake mockSecure store:
 * providers are saved per account, secrets never reach MMKV, a failed
 * refresh keeps the saved list, and removing a provider cleans up.
 */
import { useSessionStore } from '@/auth/session-store';

import { SAMPLE_M3U } from '../test-utils/fixtures';

const mockKv = new Map<string, string>();
const mockSecure = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockResponses = new Map<string, unknown>();
const mockTexts = new Map<string, string>();
const mockRequested: string[] = [];

jest.mock('@/storage/kv', () => ({
  storage: {
    getString: (k: string) => mockKv.get(k),
    set: (k: string, v: string) => void mockKv.set(k, v),
    remove: (k: string) => void mockKv.delete(k),
    clearAll: () => mockKv.clear(),
  },
}));
jest.mock('@/storage/secure', () => ({
  secureStore: { get: (k: string) => mockSecure.get(k) ?? null, set: (k: string, v: string) => void mockSecure.set(k, v), remove: (k: string) => void mockSecure.delete(k) },
}));
jest.mock('../files', () => ({
  iptvFiles: {
    persistent: true,
    read: async (p: string) => mockFiles.get(p) ?? null,
    write: async (p: string, t: string) => void mockFiles.set(p, t),
    remove: async (p: string) => {
      for (const k of [...mockFiles.keys()]) if (k.startsWith(p)) mockFiles.delete(k);
    },
  },
}));
jest.mock('../transport', () => {
  const { IptvError } = jest.requireActual('../errors');
  return {
    transport: {
      sendsUserAgent: true,
      text(url: string) {
        mockRequested.push(url);
        const t = mockTexts.get(url);
        if (t === undefined) throw new IptvError('http', 404);
        return jest.requireActual('../test-utils/fixtures').inChunks(t, 100);
      },
      async json(url: string) {
        mockRequested.push(url);
        if (!mockResponses.has(url)) throw new IptvError('network');
        return mockResponses.get(url);
      },
    },
  };
});
jest.mock('@/auth/session-store', () => {
  const { create: make } = jest.requireActual('zustand');
  return { useSessionStore: make(() => ({ session: { serverId: 's1', userId: 'u1' } })) };
});

// eslint-disable-next-line import/first
import { formValues, playRequest, refresh, removeProvider, saveProvider, toggleFavourite, ensureLoaded } from '../manager';
// eslint-disable-next-line import/first
import { iptvState, patchData, setIptvState } from '../store';

const PLAYLIST = 'https://lists.example.com/get.php?token=t0ken';
const XTREAM = 'http://panel.example.com:8080';
const api = (q: string) => `${XTREAM}/player_api.php?username=jane&password=s3cret${q}`;

beforeEach(() => {
  mockKv.clear();
  mockSecure.clear();
  mockFiles.clear();
  mockResponses.clear();
  mockTexts.clear();
  mockRequested.length = 0;
  setIptvState({ scope: null });
});

function mmkvText(): string {
  return [...mockKv.values()].join('\n');
}

describe('IPTV manager', () => {
  it('adds an M3U provider: secrets in the secure store, channels in a file, nothing secret in MMKV', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'Home list', playlistUrl: PLAYLIST, guideUrl: null, userAgent: ' Agent/1 ' });
    const st = iptvState();
    expect(st.providers.providers[id]).toMatchObject({ kind: 'm3u', name: 'Home list', userAgent: 'Agent/1', channelCount: 7, hasGuide: true });
    expect(st.activeId).toBe(id);
    expect(st.data[id].status).toBe('ready');
    expect(JSON.parse(mockSecure.get(`iptv.${id}`) ?? '{}')).toEqual({ playlistUrl: PLAYLIST, playlistGuideUrl: 'https://epg.example.com/guide.xml.gz' });
    expect(mockFiles.has(`iptv/${id}/channels.json`)).toBe(true);
    expect(mmkvText()).not.toMatch(/t0ken|example\.com\/get/);
    expect(mockKv.has('iptv.providers.s1.u1')).toBe(true);
  });

  it('refuses a playlist that is not one, and saves nothing', async () => {
    mockTexts.set(PLAYLIST, '<html>login</html>');
    await expect(saveProvider({ kind: 'm3u', name: '', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null })).rejects.toMatchObject({ kind: 'notM3u' });
    await expect(saveProvider({ kind: 'm3u', name: '', playlistUrl: 'ftp://x', guideUrl: null, userAgent: null })).rejects.toMatchObject({ kind: 'badAddress' });
    expect(mockSecure.size).toBe(0);
  });

  it('adds an Xtream provider after the login check, and keeps the password when the edit form leaves it empty', async () => {
    mockResponses.set(api(''), { user_info: { auth: 1, status: 'Active' } });
    mockResponses.set(api('&action=get_live_categories'), [{ category_id: '1', category_name: 'News' }]);
    mockResponses.set(api('&action=get_live_streams'), [{ name: 'Example News', stream_id: 5, category_id: '1' }]);
    const id = await saveProvider({ kind: 'xtream', name: 'Panel', server: 'panel.example.com:8080/', username: 'jane', password: 's3cret', userAgent: null });
    expect(iptvState().data[id].channels).toEqual([{ id: '5', name: 'Example News', group: 'News', streamId: 5 }]);
    expect(mmkvText()).not.toMatch(/s3cret|jane/);
    expect(formValues(id)).toEqual({ kind: 'xtream', name: 'Panel', server: XTREAM, username: 'jane', password: '', userAgent: null });
    await saveProvider({ kind: 'xtream', name: 'Panel 2', server: XTREAM, username: 'jane', password: '', userAgent: null }, id);
    expect(iptvState().providers.order).toEqual([id]);
    expect(JSON.parse(mockSecure.get(`iptv.${id}`) ?? '{}').password).toBe('s3cret');

    const req = playRequest(id, iptvState().data[id].channels, iptvState().data[id].channels[0]);
    const stream = await req.source.resolve('5');
    // Jest runs as iOS: HLS.
    expect(stream.candidates).toEqual([{ url: `${XTREAM}/live/jane/s3cret/5.m3u8`, isHls: true }]);
  });

  it('says why a login fails', async () => {
    mockResponses.set(api(''), { user_info: { auth: 0 } });
    await expect(saveProvider({ kind: 'xtream', name: '', server: XTREAM, username: 'jane', password: 's3cret', userAgent: null })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('keeps the saved list when a refresh fails', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    mockTexts.delete(PLAYLIST);
    await refresh(id);
    const d = iptvState().data[id];
    expect(d.status).toBe('ready');
    expect(d.channels).toHaveLength(7);
    expect(d.error).toMatch(/HTTP 404/);
    expect(d.error).not.toMatch(/example/);
  });

  it('loads the saved list from the file without asking the provider', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    patchData(id, { status: 'idle', channels: [], index: null });
    mockRequested.length = 0;
    await ensureLoaded(id);
    expect(iptvState().data[id].channels).toHaveLength(7);
    expect(mockRequested.filter((u) => u === PLAYLIST)).toHaveLength(0);
  });

  it('removes a provider with its secrets, lists and files', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    const ch = iptvState().data[id].channels[0];
    expect(toggleFavourite(id, ch.id)).toBe(true);
    expect(mockKv.has(`iptv.lists.${id}`)).toBe(true);
    await removeProvider(id);
    expect(iptvState().providers.order).toEqual([]);
    expect(iptvState().activeId).toBeNull();
    expect(mockSecure.size).toBe(0);
    expect(mockKv.has(`iptv.lists.${id}`)).toBe(false);
    expect([...mockFiles.keys()]).toEqual([]);
  });

  it('keeps providers per account', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    useSessionStore.setState({ session: { serverId: 's1', userId: 'u2' } });
    // Another call that needs the scope moves the store to the new account.
    await expect(saveProvider({ kind: 'm3u', name: '', playlistUrl: 'nope', guideUrl: null, userAgent: null })).rejects.toBeTruthy();
    expect(iptvState().providers.order).toEqual([]);
    useSessionStore.setState({ session: { serverId: 's1', userId: 'u1' } });
  });
});
