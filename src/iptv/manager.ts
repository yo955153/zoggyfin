/**
 * IPTV actions: providers (add, edit, remove, refresh), the channel cache in
 * files, the guides, favourites and recents, and playing a channel. Screens
 * reach it through `index.ts`. The pure rules live in their own files; this
 * file does the I/O. Nothing here logs a URL or a secret.
 */
import { Platform } from 'react-native';

import { useSessionStore } from '@/auth/session-store';
import { randomId } from '@/lib/id';
import { tsBridge } from '@/native/ts-bridge';
import { isDesktop } from '@/platform/desktop';
import { isTV } from '@/platform/tv';
import type { LiveChannelRef, LivePlayRequest, LiveSource } from '@/player';

import { IptvError, iptvErrorText, isHttpUrl } from './errors';
import { iptvFiles } from './files';
import { EMPTY_GUIDE, guideIdFor, isStale, nowNext, withProgrammes } from './guide';
import { addRecent, EMPTY_LISTS, toggleFavourite as toggleIn } from './lists';
import { parseM3u } from './m3u';
import { migrateChannelsFile, migrateGuide } from './migrate';
import { buildSearchIndex } from './search';
import { readSecrets, removeSecrets, writeSecrets } from './secrets';
import {
  EMPTY_DATA,
  iptvState,
  loadActive,
  loadLists,
  loadProviders,
  patchData,
  removeLists,
  saveActive,
  saveLists,
  saveProviders,
  type Scope,
  scopeId,
  setIptvState,
} from './store';
import { liveStreamFor, type StreamPlatform } from './stream-url';
import { transport } from './transport';
import { MAX_JSON_BYTES, MAX_LIST_BYTES } from './transport-types';
import {
  CHANNELS_SCHEMA_VERSION,
  type Channel,
  type ChannelsFile,
  GUIDE_SCHEMA_VERSION,
  type GuideWindow,
  type NowNext,
  PROVIDERS_SCHEMA_VERSION,
  type ProviderInput,
  type ProviderRecord,
  type ProviderSecrets,
} from './types';
import { parseXmltv } from './xmltv';
import { normalizeXtreamInput, parseXtreamAuth, parseXtreamCategories, parseXtreamShortEpg, parseXtreamStreams, type XtreamLogin, xtreamApiUrl } from './xtream';

const HOUR = 3_600_000;
/** A saved list older than this loads again in the background when the page opens. */
const STALE_LIST_MS = 24 * HOUR;
/** The XMLTV window: programmes from now to this far ahead. */
const GUIDE_WINDOW_MS = 6 * HOUR;

export const streamPlatform: StreamPlatform =
  Platform.OS === 'ios' ? (isTV ? 'tvos' : 'ios') : Platform.OS === 'android' ? 'android' : isDesktop ? 'desktop' : 'web';

const dirOf = (id: string) => `iptv/${id}`;
const channelsPath = (id: string) => `iptv/${id}/channels.json`;
const guidePath = (id: string) => `iptv/${id}/guide.json`;
const namesPath = (id: string) => `iptv/${id}/names.json`;

// ---- Session scope ---------------------------------------------------------------

function currentScope(): Scope | null {
  const s = useSessionStore.getState().session;
  return s ? { serverId: s.serverId, userId: s.userId } : null;
}

function applyScope(scope: Scope | null): void {
  const id = scope ? scopeId(scope) : null;
  if (iptvState().scope === id) return;
  const providers = scope ? loadProviders(scope) : { schemaVersion: PROVIDERS_SCHEMA_VERSION, providers: {}, order: [] };
  const saved = scope ? loadActive(scope) : null;
  const activeId = saved && providers.providers[saved] ? saved : (providers.order[0] ?? null);
  // Another account: its providers only; the memory of the old ones goes.
  setIptvState({ scope: id, providers, activeId, data: {}, lists: {}, guides: {}, guideNames: {}, guideStatus: {} });
}

let bound = false;

/** Follows the signed-in account (providers belong to one account). Safe to call often. */
export function bindSession(): void {
  if (bound) return;
  bound = true;
  applyScope(currentScope());
  useSessionStore.subscribe((s, prev) => {
    if (s.session?.serverId !== prev.session?.serverId || s.session?.userId !== prev.session?.userId) applyScope(currentScope());
  });
}

function requireScope(): Scope {
  const scope = currentScope();
  if (!scope) throw new Error('Sign in first.');
  applyScope(scope);
  return scope;
}

function saveSnapshot(scope: Scope, providers: Record<string, ProviderRecord>, order: string[]): void {
  const snap = { schemaVersion: PROVIDERS_SCHEMA_VERSION, providers, order };
  setIptvState({ providers: snap });
  saveProviders(scope, snap);
}

export function setActiveProvider(id: string | null): void {
  const scope = currentScope();
  setIptvState({ activeId: id });
  if (scope) saveActive(scope, id);
}

export function providerById(id: string): ProviderRecord | null {
  return iptvState().providers.providers[id] ?? null;
}

// ---- Loading channels --------------------------------------------------------------

function xtreamLogin(record: ProviderRecord, secrets: ProviderSecrets): XtreamLogin | null {
  if (record.kind !== 'xtream' || !record.server || !secrets.username || !secrets.password) return null;
  return { server: record.server, username: secrets.username, password: secrets.password };
}

async function fetchXtream(login: XtreamLogin, userAgent: string | null): Promise<Channel[]> {
  const opts = { userAgent, maxBytes: MAX_JSON_BYTES };
  const auth = parseXtreamAuth(await transport.json(xtreamApiUrl(login), opts));
  if (!auth.ok) throw new IptvError(auth.reason);
  const [cats, streams] = await Promise.all([
    transport.json(xtreamApiUrl(login, 'get_live_categories'), opts),
    transport.json(xtreamApiUrl(login, 'get_live_streams'), opts),
  ]);
  return parseXtreamStreams(streams, parseXtreamCategories(cats));
}

async function fetchM3u(url: string, userAgent: string | null): Promise<{ channels: Channel[]; guideUrls: string[] }> {
  if (!isHttpUrl(url)) throw new IptvError('badAddress');
  const r = await parseM3u(transport.text(url.trim(), { userAgent, maxBytes: MAX_LIST_BYTES }));
  if (!r.looksLikeM3u) throw new IptvError('notM3u');
  return { channels: r.channels, guideUrls: r.guideUrls };
}

/** Fetches the channels of a provider (no state changes). */
async function fetchChannels(record: ProviderRecord, secrets: ProviderSecrets): Promise<{ channels: Channel[]; playlistGuideUrl?: string }> {
  if (record.kind === 'xtream') {
    const login = xtreamLogin(record, secrets);
    if (!login) throw new IptvError('denied');
    const channels = await fetchXtream(login, record.userAgent);
    if (!channels.length) throw new IptvError('empty');
    return { channels };
  }
  if (!secrets.playlistUrl) throw new IptvError('badAddress');
  const r = await fetchM3u(secrets.playlistUrl, record.userAgent);
  if (!r.channels.length) throw new IptvError('empty');
  return { channels: r.channels, playlistGuideUrl: r.guideUrls.find(isHttpUrl) };
}

function showChannels(id: string, channels: Channel[]): void {
  patchData(id, { status: 'ready', channels, index: buildSearchIndex(channels), error: null, refreshing: false });
}

async function writeChannels(id: string, channels: Channel[]): Promise<void> {
  const file: ChannelsFile = { schemaVersion: CHANNELS_SCHEMA_VERSION, providerId: id, savedAt: Date.now(), channels };
  try {
    await iptvFiles.write(channelsPath(id), JSON.stringify(file));
  } catch (e) {
    console.warn('[iptv] the channel list was not saved', e instanceof Error ? e.name : 'error');
  }
}

const inFlight = new Map<string, Promise<void>>();

/** Loads the channel list from the provider again and saves it. */
export function refresh(id: string): Promise<void> {
  const running = inFlight.get(id);
  if (running) return running;
  const job = (async () => {
    const record = providerById(id);
    if (!record) return;
    const data = iptvState().data[id] ?? EMPTY_DATA;
    patchData(id, data.status === 'ready' ? { refreshing: true, error: null } : { status: 'loading', error: null });
    try {
      const secrets = readSecrets(id);
      const r = await fetchChannels(record, secrets);
      if (!providerById(id)) return;
      if (r.playlistGuideUrl !== secrets.playlistGuideUrl) writeSecrets(id, { ...secrets, playlistGuideUrl: r.playlistGuideUrl });
      showChannels(id, r.channels);
      await writeChannels(id, r.channels);
      updateRecord(id, { refreshedAt: Date.now(), channelCount: r.channels.length, hasGuide: record.kind === 'xtream' || !!(secrets.guideUrl || r.playlistGuideUrl) });
      void loadGuide(id, true);
    } catch (e) {
      const text = iptvErrorText(e);
      const now = iptvState().data[id] ?? EMPTY_DATA;
      // A refresh that fails keeps the saved list; the error shows above it.
      patchData(id, now.channels.length ? { status: 'ready', refreshing: false, error: text } : { status: 'error', error: text, refreshing: false });
    }
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

/** Shows the saved list (or loads it), and refreshes a list that is a day old. */
export async function ensureLoaded(id: string): Promise<void> {
  const data = iptvState().data[id];
  if (!iptvState().lists[id]) setIptvState({ lists: { ...iptvState().lists, [id]: loadLists(id) } });
  if (data && data.status !== 'idle') return;
  patchData(id, { status: 'loading', error: null });
  const raw = await iptvFiles.read(channelsPath(id));
  let file: ChannelsFile | null = null;
  if (raw) {
    try {
      file = migrateChannelsFile(JSON.parse(raw), id);
    } catch {
      file = null;
    }
  }
  if (file && file.channels.length) {
    showChannels(id, file.channels);
    void loadGuide(id, false);
    if (Date.now() - file.savedAt > STALE_LIST_MS) void refresh(id);
    return;
  }
  await refresh(id);
}

function updateRecord(id: string, patch: Partial<ProviderRecord>): void {
  const scope = currentScope();
  const st = iptvState();
  const record = st.providers.providers[id];
  if (!scope || !record) return;
  saveSnapshot(scope, { ...st.providers.providers, [id]: { ...record, ...patch, updatedAt: Date.now() } }, st.providers.order);
}

// ---- Providers --------------------------------------------------------------------

function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, 60) || fallback;
}

function cleanAgent(ua: string | null): string | null {
  const v = ua?.trim() ?? '';
  return v && v.length <= 256 && !/[\u0000-\u001f]/.test(v) ? v : null;
}

/** The record and secrets for form input; throws an IptvError for a bad address. */
function fromInput(input: ProviderInput, base: Pick<ProviderRecord, 'id' | 'createdAt'>, keep: ProviderSecrets): { record: ProviderRecord; secrets: ProviderSecrets } {
  const now = Date.now();
  if (input.kind === 'xtream') {
    const n = normalizeXtreamInput(input.server);
    if (!n) throw new IptvError('badAddress');
    const username = input.username.trim() || n.username || '';
    // An empty password in the edit form keeps the saved one.
    const password = input.password || n.password || keep.password || '';
    if (!username || !password) throw new IptvError('denied');
    return {
      record: { ...base, kind: 'xtream', name: cleanName(input.name, 'Xtream'), server: n.server, userAgent: cleanAgent(input.userAgent), hasGuide: true, updatedAt: now, refreshedAt: null, channelCount: 0 },
      secrets: { username, password },
    };
  }
  const playlistUrl = input.playlistUrl.trim();
  if (!isHttpUrl(playlistUrl)) throw new IptvError('badAddress');
  const guideUrl = input.guideUrl?.trim() || undefined;
  if (guideUrl && !isHttpUrl(guideUrl)) throw new IptvError('badAddress');
  return {
    record: { ...base, kind: 'm3u', name: cleanName(input.name, 'Playlist'), server: null, userAgent: cleanAgent(input.userAgent), hasGuide: !!guideUrl, updatedAt: now, refreshedAt: null, channelCount: 0 },
    secrets: { playlistUrl, guideUrl },
  };
}

/**
 * Adds a provider, or saves changes to one (`id`). The channel list loads
 * first: a provider that does not answer is not saved, and the error says
 * why. Returns the provider id.
 */
export async function saveProvider(input: ProviderInput, id?: string): Promise<string> {
  const scope = requireScope();
  const old = id ? providerById(id) : null;
  const pid = old?.id ?? randomId();
  const { record, secrets } = fromInput(input, { id: pid, createdAt: old?.createdAt ?? Date.now() }, id ? readSecrets(pid) : {});
  const r = await fetchChannels(record, secrets);
  const full: ProviderSecrets = { ...secrets, playlistGuideUrl: r.playlistGuideUrl };
  writeSecrets(pid, full);
  const st = iptvState();
  const saved: ProviderRecord = {
    ...record,
    refreshedAt: Date.now(),
    channelCount: r.channels.length,
    hasGuide: record.kind === 'xtream' || !!(full.guideUrl || full.playlistGuideUrl),
  };
  const order = st.providers.order.includes(pid) ? st.providers.order : [...st.providers.order, pid];
  saveSnapshot(scope, { ...st.providers.providers, [pid]: saved }, order);
  if (!iptvState().lists[pid]) setIptvState({ lists: { ...iptvState().lists, [pid]: loadLists(pid) } });
  showChannels(pid, r.channels);
  // A changed guide or login: the old guide goes.
  setIptvState({ guides: { ...iptvState().guides, [pid]: EMPTY_GUIDE }, guideStatus: { ...iptvState().guideStatus, [pid]: 'idle' } });
  await writeChannels(pid, r.channels);
  setActiveProvider(pid);
  void loadGuide(pid, true);
  return pid;
}

/** Removes a provider with its secrets, files, favourites and recents. */
export async function removeProvider(id: string): Promise<void> {
  const scope = requireScope();
  const st = iptvState();
  const { [id]: _gone, ...rest } = st.providers.providers;
  saveSnapshot(scope, rest, st.providers.order.filter((x) => x !== id));
  removeSecrets(id);
  removeLists(id);
  const { [id]: _d, ...data } = st.data;
  const { [id]: _g, ...guides } = st.guides;
  setIptvState({ data, guides });
  if (st.activeId === id) setActiveProvider(iptvState().providers.order[0] ?? null);
  await iptvFiles.remove(dirOf(id));
}

/** What the edit form shows: the saved values, without the password. */
export function formValues(id: string): ProviderInput | null {
  const record = providerById(id);
  if (!record) return null;
  const s = readSecrets(id);
  if (record.kind === 'xtream') return { kind: 'xtream', name: record.name, server: record.server ?? '', username: s.username ?? '', password: '', userAgent: record.userAgent };
  return { kind: 'm3u', name: record.name, playlistUrl: s.playlistUrl ?? '', guideUrl: s.guideUrl ?? null, userAgent: record.userAgent };
}

// ---- Favourites and recents ------------------------------------------------------------

function setLists(id: string, update: (l: typeof EMPTY_LISTS) => typeof EMPTY_LISTS): void {
  const current = iptvState().lists[id] ?? loadLists(id);
  const next = update(current);
  setIptvState({ lists: { ...iptvState().lists, [id]: next } });
  saveLists(id, next);
}

export function toggleFavourite(providerId: string, channelId: string): boolean {
  setLists(providerId, (l) => toggleIn(l, channelId));
  return (iptvState().lists[providerId]?.favourites ?? []).includes(channelId);
}

export function markWatched(providerId: string, channelId: string): void {
  setLists(providerId, (l) => addRecent(l, channelId, Date.now()));
}

// ---- Guide ----------------------------------------------------------------------------

function setGuide(id: string, guide: GuideWindow): void {
  setIptvState({ guides: { ...iptvState().guides, [id]: guide } });
}

function setGuideStatus(id: string, status: 'idle' | 'loading' | 'ready' | 'error'): void {
  setIptvState({ guideStatus: { ...iptvState().guideStatus, [id]: status } });
}

/**
 * M3U: reads the XMLTV guide into a window of a few hours (saved, so a
 * restart shows now and next at once). Xtream: nothing up front; now and
 * next load per channel (`requestNowNext`).
 */
export async function loadGuide(id: string, force: boolean): Promise<void> {
  const record = providerById(id);
  if (!record || record.kind !== 'm3u' || iptvState().guideStatus[id] === 'loading') return;
  const secrets = readSecrets(id);
  const url = secrets.guideUrl ?? secrets.playlistGuideUrl;
  if (!url) return;
  const now = Date.now();
  if (!force && !iptvState().guides[id]) {
    const [raw, rawNames] = await Promise.all([iptvFiles.read(guidePath(id)), iptvFiles.read(namesPath(id))]);
    try {
      const saved = raw ? migrateGuide(JSON.parse(raw)) : null;
      if (saved && saved.to > now + HOUR) {
        setGuide(id, saved);
        if (rawNames) setIptvState({ guideNames: { ...iptvState().guideNames, [id]: JSON.parse(rawNames) as Record<string, string> } });
        setGuideStatus(id, 'ready');
        return;
      }
    } catch {
      // Load it again.
    }
  }
  const current = iptvState().guides[id];
  if (!force && current && current.to > now + HOUR) return;
  setGuideStatus(id, 'loading');
  try {
    const channels = iptvState().data[id]?.channels ?? [];
    const keep = new Set<string>();
    const matchNames = new Set<string>();
    for (const c of channels) {
      if (c.epgId) keep.add(c.epgId);
      else matchNames.add(c.name.trim().toLowerCase());
    }
    const r = await parseXmltv(transport.text(url, { userAgent: record.userAgent, maxBytes: MAX_LIST_BYTES }), {
      from: now - 30 * 60_000,
      to: now + GUIDE_WINDOW_MS,
      keep: channels.length ? keep : null,
      matchNames,
      maxPerChannel: 4,
    });
    if (!r.looksLikeXmltv) throw new IptvError('notXmltv');
    const names: Record<string, string> = {};
    for (const n of matchNames) {
      const gid = r.names.get(n);
      if (gid) names[n] = gid;
    }
    setGuide(id, r.guide);
    setIptvState({ guideNames: { ...iptvState().guideNames, [id]: names } });
    setGuideStatus(id, 'ready');
    await Promise.all([iptvFiles.write(guidePath(id), JSON.stringify(r.guide)), iptvFiles.write(namesPath(id), JSON.stringify(names))]).catch(() => undefined);
  } catch (e) {
    setGuideStatus(id, 'error');
    console.warn('[iptv] guide failed:', iptvErrorText(e));
  }
}

/** Xtream short-guide requests: at most two at a time, each channel once until its programmes run out. */
const epgQueue: { providerId: string; channel: Channel }[] = [];
const epgPending = new Set<string>();
let epgRunning = 0;
const EPG_PARALLEL = 2;

function pumpEpg(): void {
  while (epgRunning < EPG_PARALLEL && epgQueue.length) {
    const job = epgQueue.shift();
    if (!job) break;
    epgRunning++;
    void fetchShortEpg(job.providerId, job.channel).finally(() => {
      epgRunning--;
      epgPending.delete(`${job.providerId}:${job.channel.id}`);
      pumpEpg();
    });
  }
}

async function fetchShortEpg(providerId: string, channel: Channel): Promise<void> {
  const record = providerById(providerId);
  const login = record ? xtreamLogin(record, readSecrets(providerId)) : null;
  if (!record || !login || channel.streamId === undefined) return;
  try {
    const json = await transport.json(xtreamApiUrl(login, 'get_short_epg', { stream_id: channel.streamId, limit: 4 }), { userAgent: record.userAgent, maxBytes: MAX_JSON_BYTES });
    const progs = parseXtreamShortEpg(json);
    setGuide(providerId, withProgrammes(iptvState().guides[providerId] ?? EMPTY_GUIDE, channel.id, progs));
  } catch {
    // No guide for this channel now: it is asked again when it shows next time.
    setGuide(providerId, withProgrammes(iptvState().guides[providerId] ?? { ...EMPTY_GUIDE, schemaVersion: GUIDE_SCHEMA_VERSION }, channel.id, []));
  }
}

/** Xtream: asks for now and next of channels that show (rows on screen, the channel that plays). */
export function requestNowNext(providerId: string, channels: readonly Channel[]): void {
  const record = providerById(providerId);
  if (!record || record.kind !== 'xtream') return;
  const guide = iptvState().guides[providerId] ?? EMPTY_GUIDE;
  const now = Date.now();
  for (const c of channels) {
    const key = `${providerId}:${c.id}`;
    if (epgPending.has(key) || !isStale(guide, c.id, now)) continue;
    epgPending.add(key);
    epgQueue.push({ providerId, channel: c });
  }
  pumpEpg();
}

/** Now and next of a channel from the loaded guide. */
export function nowNextOf(providerId: string, channel: Channel, at: number): NowNext {
  const st = iptvState();
  const guide = st.guides[providerId];
  if (!guide) return { now: null, next: null };
  const record = st.providers.providers[providerId];
  const key = record?.kind === 'xtream' ? channel.id : guideIdFor(channel, new Map(Object.entries(st.guideNames[providerId] ?? {})));
  return key ? nowNext(guide.channels[key], at) : { now: null, next: null };
}

// ---- Playing ----------------------------------------------------------------------------

function refOf(c: Channel): LiveChannelRef {
  return { id: c.id, name: c.name, logo: c.logo ?? null, number: c.number ?? null, group: c.group };
}

function sourceFor(providerId: string): LiveSource {
  const find = (channelId: string) => iptvState().data[providerId]?.channels.find((c) => c.id === channelId) ?? null;
  return {
    providerId,
    async resolve(channelId) {
      const record = providerById(providerId);
      const channel = find(channelId);
      if (!record || !channel) return { candidates: [], userAgent: null, unsupported: 'This channel is not in the list any more.' };
      return liveStreamFor(channel, record, xtreamLogin(record, readSecrets(providerId)), streamPlatform, tsBridge !== null);
    },
    nowLine(channelId) {
      const channel = find(channelId);
      if (!channel) return null;
      requestNowNext(providerId, [channel]);
      return nowNextOf(providerId, channel, Date.now()).now?.title ?? null;
    },
    onStart(channelId) {
      markWatched(providerId, channelId);
    },
  };
}

/** The play request for a channel in a list (channel up and down move through the list). */
export function playRequest(providerId: string, list: readonly Channel[], channel: Channel): LivePlayRequest {
  const index = Math.max(0, list.findIndex((c) => c.id === channel.id));
  return { channels: (list.length ? list : [channel]).map(refOf), index, source: sourceFor(providerId) };
}
