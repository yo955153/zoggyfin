/**
 * Internet mode: Jellyfin SyncPlay. Everyone in a group is a user on the
 * same server. The server keeps the group queue and the state, and sends
 * commands with a server time (`When`). Each client syncs its clock with the
 * server (GET /GetUtcTime, NTP style), follows the commands with an
 * AnchorFollower and reports Buffering / Ready.
 *
 * Works on web and native. Messages come through the SDK's WebSocket.
 */
import type { Api } from '@jellyfin/sdk';
import { router } from 'expo-router';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getSyncPlayApi } from '@jellyfin/sdk/lib/utils/api/sync-play-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';
import { isAudioItem, type PlayRequest } from '@/player';
import { type PlayRoute, playRouter } from '@/player/play-router';
import { slimItem } from '@/player/audio/item';
import { isLongFormList } from '@/player/audio/long-form';
import { audioSession } from '@/player/audio/session';
import { audioState } from '@/player/audio/store';
import { controlGate, queueGate, type UserControl } from '@/player/control-gate';
import { videoSession } from '@/player/session';
import { playerState } from '@/player/store';

import { AnchorFollower } from './anchor-follower';
import { ClockSync, isoToMs } from './clock';
import { IDLE } from './machine';
import { bindAudioPort } from './audio-binding';
import { bindVideoPort, type BoundPort, whenPlayerReady } from './player-binding';
import { realTimers } from './player-port';
import { setSyncPlayView, setTogether, togetherState } from './store';
import { syncLog } from './sync-log';
import { commandEffect, groupView, type QueueTarget, queueTarget, sameQueue, secondsToTicks, syncPlayRepeat } from './syncplay-logic';

export const syncPlaySupported: boolean = features.watchTogether;

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);

export function canSyncPlay(item: BaseItemDto | null | undefined): boolean {
  return syncPlaySupported && !!item && (VIDEO_TYPES.has(item.Type ?? '') || isAudioItem(item));
}

/** Loads the group queue's items, in the queue's order (an item can be in it twice). */
async function itemsByIds(api: Api, userId: string, ids: string[]): Promise<BaseItemDto[]> {
  const unique = [...new Set(ids)];
  const { data } = await getLibraryApi(api).getItems({ userId, ids: unique, fields: ['MediaSources', 'Chapters'], enableUserData: true });
  const byId = new Map((data.Items ?? []).map((i) => [i.Id, i] as const));
  return ids.map((id) => byId.get(id)).filter((i): i is BaseItemDto => !!i);
}

interface WsMessage {
  MessageType?: string;
  Data?: unknown;
}

interface GroupUpdateMsg {
  GroupId?: string;
  Type?: string;
  Data?: unknown;
}

class SyncPlayController {
  private unsub: (() => void) | null = null;
  private clock = new ClockSync(10);
  private follower = new AnchorFollower({
    now: () => Date.now(),
    remoteNow: () => this.serverNow(),
    timers: realTimers,
    onSample: (s) => syncLog.sample(s),
  });
  private port: BoundPort | null = null;
  private target: QueueTarget | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private loading: string | null = null;
  private groupId: string | null = null;
  /** The group plays audio: the audio player follows the group queue (entry keys are SyncPlay's playlist item ids). */
  private audio = false;
  private unsubTrack: (() => void) | null = null;
  /** This device set the group queue last: it starts the next episode at the end (one member, not all). */
  private picker = false;
  private pickedAt = 0;

  /**
   * The play router of a group: a Play button anywhere in the app sets the
   * group queue (SetNewQueue), so everyone loads the item.
   */
  private readonly router: PlayRoute = {
    route: (request) => {
      void this.playRequest(request).catch((e: unknown) => toast(describeError(e).title));
      return null;
    },
    autoplay: () => this.picker,
    queueLock: () => 'Pick an album or a playlist to play it for the group.',
  };

  private api(): Api | null {
    const s = useSessionStore.getState().session;
    return s ? getApi(s.serverUrl, s.token) : null;
  }

  private serverNow(): number | null {
    const e = this.clock.estimate();
    return e ? Date.now() + e.offset : null;
  }

  private serverIso(): string {
    return new Date(this.serverNow() ?? Date.now()).toISOString();
  }

  async refreshGroups(): Promise<void> {
    const api = this.api();
    if (!api) return;
    setSyncPlayView({ loading: true, error: null });
    try {
      const { data } = await getSyncPlayApi(api).syncPlayGetGroups();
      setSyncPlayView({ groups: (data ?? []).map(groupView).filter((g) => g !== null), loading: false });
    } catch (e) {
      setSyncPlayView({ loading: false, error: describeError(e).title });
    }
  }

  /** Creates a group. With an item, the group starts with it in the queue. */
  async create(item: BaseItemDto | null): Promise<void> {
    const api = this.api();
    const s = useSessionStore.getState().session;
    if (!api || !s) return;
    this.listen(api);
    try {
      await getSyncPlayApi(api).syncPlayCreateGroup({ newGroupRequestDto: { GroupName: `${s.userName}'s group` } });
      if (item?.Id) await this.playInGroup(item);
    } catch (e) {
      setSyncPlayView({ error: describeError(e).title });
    }
  }

  async join(groupId: string): Promise<void> {
    const api = this.api();
    if (!api) return;
    this.listen(api);
    try {
      await getSyncPlayApi(api).syncPlayJoinGroup({ joinGroupRequestDto: { GroupId: groupId } });
    } catch (e) {
      setSyncPlayView({ error: describeError(e).title });
    }
  }

  async leave(): Promise<void> {
    const api = this.api();
    try {
      if (api) await getSyncPlayApi(api).syncPlayLeaveGroup();
    } catch {
      // The server forgets the group member when the socket closes.
    }
    this.teardown();
  }

  /** A Play button while in the group: the request becomes the group queue. */
  async playRequest(request: PlayRequest): Promise<void> {
    const api = this.api();
    const s = useSessionStore.getState().session;
    if (!api || !s || !request.item.Id) return;
    let ids: string[];
    let index = 0;
    let start = request.startPositionTicks;
    if (isAudioItem(request.item)) {
      if (request.list?.length) {
        ids = request.list.map((i) => i.Id).filter((x): x is string => !!x);
        index = Math.max(0, request.index ?? ids.indexOf(request.item.Id));
      } else if (request.item.Type === 'Audio' || request.item.Type === 'AudioBook') {
        ids = [request.item.Id, ...(request.queue ?? []).map((i) => i.Id).filter((x): x is string => !!x)];
      } else {
        const tracks = await jf.getAudioTracks(api, s.userId, request.item);
        ids = tracks.map((t) => t.Id).filter((x): x is string => !!x);
      }
      if (request.shuffle) {
        ids = [...ids].sort(() => Math.random() - 0.5);
        index = 0;
      }
      start ??= 0;
    } else {
      // A show or a season: the episode to watch, as the player picks it.
      const target = await jf.resolvePlayable(api, s.userId, request.item);
      if (!target?.Id) {
        toast('Nothing to play here yet.');
        return;
      }
      ids = [target.Id, ...(request.queue ?? []).map((i) => i.Id).filter((x): x is string => !!x && x !== target.Id)];
      start ??= target.Id === request.item.Id ? (request.item.UserData?.PlaybackPositionTicks ?? target.UserData?.PlaybackPositionTicks ?? 0) : (target.UserData?.PlaybackPositionTicks ?? 0);
    }
    if (!ids.length) {
      toast('Nothing to play here yet.');
      return;
    }
    this.picker = true;
    this.pickedAt = Date.now();
    const at = Math.min(index, 499);
    const from = Math.max(0, at - 100);
    await getSyncPlayApi(api).syncPlaySetNewQueue({
      playRequestDto: { PlayingQueue: ids.slice(from, from + 500), PlayingItemPosition: at - from, StartPositionTicks: start },
    });
  }

  /** Puts an item at the head of the group queue: everyone loads it. Audio: the album, playlist or the queue that plays. */
  async playInGroup(item: BaseItemDto): Promise<void> {
    const api = this.api();
    if (!api || !item.Id) return;
    if (isAudioItem(item)) {
      await this.playAudioInGroup(item);
      return;
    }
    const st = playerState();
    const start = st.now?.item.Id === item.Id ? st.position : (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
    this.picker = true;
    this.pickedAt = Date.now();
    await getSyncPlayApi(api).syncPlaySetNewQueue({
      playRequestDto: { PlayingQueue: [item.Id], PlayingItemPosition: 0, StartPositionTicks: secondsToTicks(start) },
    });
  }

  /** The audio queue that plays now (when `item` is in it or is null), else the item's tracks. */
  private async playAudioInGroup(item: BaseItemDto | null): Promise<void> {
    const api = this.api();
    const s = useSessionStore.getState().session;
    if (!api || !s) return;
    const q = audioState().queue;
    const playing = playerState().now?.kind === 'audio' && q.entries.length > 0;
    let ids: string[];
    let index = 0;
    let start = 0;
    if (playing && (!item || item.Type === 'Audio' ? q.entries.some((e) => e.item.Id === item?.Id) || !item : item.Id === q.source?.id)) {
      ids = q.entries.map((e) => e.item.Id);
      index = Math.max(0, q.index);
      start = playerState().position;
    } else if (item) {
      const tracks = item.Type === 'Audio' || item.Type === 'AudioBook' ? [item] : await jf.getAudioTracks(api, s.userId, item);
      ids = tracks.map((t) => t.Id).filter((x): x is string => !!x);
    } else {
      return;
    }
    if (!ids.length) {
      toast('Nothing to play here yet.');
      return;
    }
    this.picker = true;
    this.pickedAt = Date.now();
    await getSyncPlayApi(api).syncPlaySetNewQueue({
      playRequestDto: { PlayingQueue: ids.slice(0, 500), PlayingItemPosition: Math.min(index, 499), StartPositionTicks: secondsToTicks(start) },
    });
  }

  /** "Listen together" from the music player: the queue that plays now. */
  async createForAudio(): Promise<void> {
    const api = this.api();
    const s = useSessionStore.getState().session;
    if (!api || !s) return;
    this.listen(api);
    try {
      await getSyncPlayApi(api).syncPlayCreateGroup({ newGroupRequestDto: { GroupName: `${s.userName}'s group` } });
      await this.playAudioInGroup(null);
    } catch (e) {
      setSyncPlayView({ error: describeError(e).title });
    }
  }

  async next(): Promise<void> {
    const api = this.api();
    if (api && this.target) await getSyncPlayApi(api).syncPlayNextItem({ nextItemRequestDto: { PlaylistItemId: this.target.playlistItemId } });
  }

  async previous(): Promise<void> {
    const api = this.api();
    if (api && this.target) await getSyncPlayApi(api).syncPlayPreviousItem({ previousItemRequestDto: { PlaylistItemId: this.target.playlistItemId } });
  }

  // ---- Socket ----------------------------------------------------------------

  private listen(api: Api): void {
    if (this.unsub) return;
    this.unsub = api.subscribe(['SyncPlayCommand', 'SyncPlayGroupUpdate'], (m) => this.onMessage(m as WsMessage));
  }

  private onMessage(m: WsMessage): void {
    if (m.MessageType === 'SyncPlayGroupUpdate') this.onGroupUpdate((m.Data ?? {}) as GroupUpdateMsg);
    else if (m.MessageType === 'SyncPlayCommand') this.onCommand((m.Data ?? {}) as Record<string, unknown>);
  }

  private onGroupUpdate(u: GroupUpdateMsg): void {
    switch (u.Type) {
      case 'GroupJoined': {
        const g = groupView((u.Data ?? {}) as Record<string, never>);
        if (!g) return;
        this.groupId = g.id;
        setTogether({ mode: 'syncplay', role: null, phase: IDLE, notice: null, item: null });
        setSyncPlayView({ group: g, error: null });
        playRouter.set(this.router);
        this.startClock();
        return;
      }
      case 'UserJoined':
      case 'UserLeft': {
        const name = typeof u.Data === 'string' ? u.Data : 'Someone';
        toast(u.Type === 'UserJoined' ? `${name} joined the group` : `${name} left the group`, { icon: 'person.2.fill' });
        void this.refreshGroup();
        return;
      }
      case 'StateUpdate': {
        const g = togetherState().syncplay.group;
        const state = (u.Data as { State?: string } | undefined)?.State;
        if (g && state) setSyncPlayView({ group: { ...g, state } });
        setTogether({ waiting: state === 'Waiting' });
        return;
      }
      case 'PlayQueue': {
        // A new queue from another member: that member starts the next episode now.
        const reason = (u.Data as { Reason?: string } | undefined)?.Reason;
        if (reason === 'NewPlaylist' && Date.now() - this.pickedAt > 5000) this.picker = false;
        const t = queueTarget((u.Data ?? {}) as Record<string, never>);
        void this.onQueue(t);
        return;
      }
      case 'GroupLeft':
      case 'NotInGroup':
      case 'GroupDoesNotExist':
      case 'LibraryAccessDenied':
        if (u.Type === 'LibraryAccessDenied') toast('You cannot play what this group plays.', { icon: 'lock.fill' });
        if (u.Type === 'GroupDoesNotExist') toast('The group does not exist any more.');
        this.teardown();
        return;
    }
  }

  private async refreshGroup(): Promise<void> {
    const api = this.api();
    if (!api || !this.groupId) return;
    try {
      const { data } = await getSyncPlayApi(api).syncPlayGetGroup({ id: this.groupId });
      const g = groupView(data);
      if (g) setSyncPlayView({ group: g });
    } catch {
      // Keep the old list.
    }
  }

  private onCommand(cmd: Record<string, unknown>): void {
    const effect = commandEffect(cmd);
    if (effect.kind === 'stop') {
      void videoSession().stop();
      return;
    }
    if (effect.kind !== 'anchor') return;
    this.follower.setAnchor(effect.anchor, this.audio ? (effect.track ?? this.target?.playlistItemId ?? null) : null);
    if (effect.reportReady) void this.reportReadyWhenLoaded();
  }

  // ---- Clock -------------------------------------------------------------------

  private startClock(): void {
    this.stopTimers();
    this.clock.reset();
    void this.sampleClock(5);
    this.timers.push(setInterval(() => void this.sampleClock(1), 20_000));
    this.timers.push(setInterval(() => this.follower.follow(false), 500));
    this.timers.push(setInterval(() => void this.ping(), 10_000));
  }

  private async sampleClock(n: number): Promise<void> {
    const api = this.api();
    if (!api) return;
    for (let i = 0; i < n; i++) {
      try {
        const t0 = Date.now();
        const { data } = await getSystemApi(api).getUtcTime();
        const t3 = Date.now();
        const t1 = isoToMs(data.RequestReceptionTime);
        const t2 = isoToMs(data.ResponseTransmissionTime);
        if (Number.isFinite(t1) && Number.isFinite(t2)) this.clock.add({ t0, t1, t2, t3 });
      } catch {
        return;
      }
    }
    const e = this.clock.estimate();
    if (e) setTogether({ sync: { offset: e.offset, rtt: e.rtt, drift: this.follower.lastDrift === null ? null : this.follower.lastDrift * 1000 } });
  }

  private async ping(): Promise<void> {
    const api = this.api();
    const e = this.clock.estimate();
    if (!api || !e) return;
    try {
      await getSyncPlayApi(api).syncPlayPing({ pingRequestDto: { Ping: Math.round(e.rtt) } });
    } catch {
      // A missed ping only makes the server's estimate older.
    }
    setTogether({ sync: { offset: e.offset, rtt: e.rtt, drift: this.follower.lastDrift === null ? null : this.follower.lastDrift * 1000 } });
  }

  // ---- Media -------------------------------------------------------------------

  private async onQueue(t: QueueTarget | null): Promise<void> {
    const prev = this.target;
    this.target = t;
    if (!t) return;
    if (this.audio && this.port && sameQueue(prev, t)) {
      await this.followAudioTrack(t);
      return;
    }
    const st = playerState();
    if (st.now?.item.Id === t.itemId && this.port) {
      await this.reportReadyWhenLoaded();
      return;
    }
    if (this.loading === t.playlistItemId) return;
    this.loading = t.playlistItemId;
    const api = this.api();
    const s = useSessionStore.getState().session;
    if (!api || !s) return;
    try {
      await this.report('buffering');
      const item = await jf.getItem(api, s.userId, t.itemId);
      if (isAudioItem(item)) {
        await this.loadAudioQueue(api, s.userId, t);
        return;
      }
      if (this.audio) this.leaveAudio();
      setTogether({ kind: 'video', item: { id: item.Id ?? t.itemId, name: item.Name ?? 'Video', type: item.Type ?? 'Video' } });
      // While it loads, the group waits: the server holds a play until this device is ready.
      void videoSession().play({ item, startPositionTicks: secondsToTicks(t.startSeconds), autoplay: false });
      router.navigate('/player');
      await new Promise((r) => setTimeout(r, 50));
      const ok = await whenPlayerReady(30_000);
      if (!ok) {
        toast('The group item could not be played here.');
        return;
      }
      this.bindPlayer();
      await this.report('ready');
    } catch (e) {
      toast(describeError(e).title);
    } finally {
      this.loading = null;
    }
  }

  /** The group plays an audio queue: the audio player plays it with SyncPlay's entry ids. */
  private async loadAudioQueue(api: Api, userId: string, t: QueueTarget): Promise<void> {
    const items = await itemsByIds(api, userId, t.entries.map((e) => e.itemId));
    if (items.length !== t.entries.length) {
      toast('Some items of the group queue are not on this server.');
      return;
    }
    if (playerState().now?.kind === 'video') await videoSession().stop();
    const entries = t.entries.map((e, i) => ({ key: e.playlistItemId, item: slimItem(items[i] as BaseItemDto), user: false }));
    const queue = { entries, index: t.entryIndex, original: entries.map((e) => e.key), shuffle: t.shuffle, repeat: t.repeat, source: null };
    this.audio = true;
    const first = items[t.entryIndex] ?? items[0];
    setTogether({ kind: 'audio', item: first ? { id: first.Id ?? '', name: first.Album ?? first.Name ?? 'Music', type: first.Type ?? 'Audio' } : null });
    queueGate.set('The group plays the queue. Use Next, Previous or the queue rows.');
    // No shared files: each track comes from this device's download or the server.
    await audioSession().loadShared(queue, isLongFormList(items, null), () => null, t.startSeconds, { reports: true });
    router.navigate('/now-playing');
    const ok = await whenPlayerReady(30_000);
    if (!ok) {
      toast('The group queue could not be played here.');
      return;
    }
    this.bindPlayer();
    this.unsubTrack?.();
    // A gapless change at the end of a track: ask the group for the next entry (the server takes the first request).
    this.unsubTrack = audioSession().onTrackChange((key) => {
      const target = this.target;
      if (!target || key === target.playlistItemId) return;
      const at = target.entries.findIndex((e) => e.playlistItemId === target.playlistItemId);
      if (target.entries[at + 1]?.playlistItemId === key) void this.next();
    });
    await this.report('ready');
  }

  /** The same group queue, another entry: wait for the gapless change, or move now. */
  private async followAudioTrack(t: QueueTarget): Promise<void> {
    const current = audioSession().direct.track();
    if (current !== t.playlistItemId) {
      await this.report('buffering');
      await audioSession().moveShared(t.playlistItemId, t.startSeconds);
      await whenPlayerReady(30_000);
    }
    if (this.port) this.follower.attach(this.port);
    await this.report('ready');
  }

  private leaveAudio(): void {
    this.audio = false;
    this.unsubTrack?.();
    this.unsubTrack = null;
    queueGate.set(null);
    audioSession().leaveShared();
  }

  private bindPlayer(): void {
    this.port?.dispose();
    this.port = this.audio ? bindAudioPort((c) => void this.control(c)) : bindVideoPort((c) => void this.control(c));
    this.port.onBuffering((b) => void this.report(b ? 'buffering' : 'ready'));
    this.follower.attach(this.port);
    const port = this.port;
    syncLog.start('guest', () => ({ pos: port.position(), playing: port.isPlaying() }), () => Date.now());
    controlGate.set((c) => {
      void this.control(c);
      return true;
    });
  }

  private async reportReadyWhenLoaded(): Promise<void> {
    await whenPlayerReady(30_000);
    await this.report('ready');
  }

  private async report(kind: 'buffering' | 'ready'): Promise<void> {
    const api = this.api();
    const t = this.target;
    if (!api || !t) return;
    const body = {
      When: this.serverIso(),
      PositionTicks: secondsToTicks(this.port?.position() ?? playerState().position),
      IsPlaying: this.port?.isPlaying() ?? false,
      PlaylistItemId: t.playlistItemId,
    };
    try {
      if (kind === 'buffering') await getSyncPlayApi(api).syncPlayBuffering({ bufferRequestDto: body });
      else await getSyncPlayApi(api).syncPlayReady({ readyRequestDto: body });
    } catch {
      // The next state report heals it.
    }
  }

  /** A control from this device: the server decides and tells everyone. */
  private async control(c: UserControl): Promise<void> {
    const api = this.api();
    if (!api) return;
    const sp = getSyncPlayApi(api);
    try {
      switch (c.action) {
        case 'play':
          await sp.syncPlayUnpause();
          return;
        case 'pause':
          await sp.syncPlayPause();
          return;
        case 'seek':
          await sp.syncPlaySeek({ seekRequestDto: { PositionTicks: secondsToTicks(c.position) } });
          return;
        case 'rate':
          toast('SyncPlay groups play at normal speed.');
          return;
        case 'next':
          await this.next();
          return;
        case 'previous':
          await this.previous();
          return;
        case 'jump':
          await sp.syncPlaySetPlaylistItem({ setPlaylistItemRequestDto: { PlaylistItemId: c.key } });
          return;
        case 'shuffle':
          await sp.syncPlaySetShuffleMode({ setShuffleModeRequestDto: { Mode: c.on ? 'Shuffle' : 'Sorted' } });
          return;
        case 'repeat':
          await sp.syncPlaySetRepeatMode({ setRepeatModeRequestDto: { Mode: syncPlayRepeat(c.mode) } });
          return;
      }
    } catch (e) {
      toast(describeError(e).title);
    }
  }

  private stopTimers(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private teardown(): void {
    syncLog.stop();
    this.stopTimers();
    this.follower.detach();
    this.port?.dispose();
    this.port = null;
    this.target = null;
    this.groupId = null;
    if (this.audio) this.leaveAudio();
    controlGate.set(null);
    playRouter.set(null);
    this.picker = false;
    this.unsub?.();
    this.unsub = null;
    setSyncPlayView({ group: null });
    if (togetherState().mode === 'syncplay') setTogether({ mode: 'none', sync: null, waiting: false, item: null });
  }
}

let controller: SyncPlayController | null = null;

export function syncPlay(): SyncPlayController {
  controller ??= new SyncPlayController();
  return controller;
}
