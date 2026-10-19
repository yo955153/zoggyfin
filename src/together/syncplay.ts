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
import { getSyncPlayApi } from '@jellyfin/sdk/lib/utils/api/sync-play-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';
import { controlGate, type UserControl } from '@/player/control-gate';
import { videoSession } from '@/player/session';
import { playerState } from '@/player/store';

import { AnchorFollower } from './anchor-follower';
import { ClockSync, isoToMs } from './clock';
import { IDLE } from './machine';
import { bindVideoPort, type BoundPort, whenPlayerReady } from './player-binding';
import { realTimers } from './player-port';
import { setSyncPlayView, setTogether, togetherState } from './store';
import { syncLog } from './sync-log';
import { commandEffect, groupView, type QueueTarget, queueTarget, secondsToTicks } from './syncplay-logic';

export const syncPlaySupported: boolean = features.watchTogether;

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);

export function canSyncPlay(item: BaseItemDto | null | undefined): boolean {
  return syncPlaySupported && !!item && VIDEO_TYPES.has(item.Type ?? '');
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

  /** Puts an item at the head of the group queue: everyone loads it. */
  async playInGroup(item: BaseItemDto): Promise<void> {
    const api = this.api();
    if (!api || !item.Id) return;
    const st = playerState();
    const start = st.now?.item.Id === item.Id ? st.position : (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
    await getSyncPlayApi(api).syncPlaySetNewQueue({
      playRequestDto: { PlayingQueue: [item.Id], PlayingItemPosition: 0, StartPositionTicks: secondsToTicks(start) },
    });
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
        setTogether({ mode: 'syncplay', role: null, phase: IDLE, notice: null });
        setSyncPlayView({ group: g, error: null });
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
    this.follower.setAnchor(effect.anchor);
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
    this.target = t;
    if (!t) return;
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

  private bindPlayer(): void {
    this.port?.dispose();
    this.port = bindVideoPort((c) => void this.control(c));
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
    controlGate.set(null);
    this.unsub?.();
    this.unsub = null;
    setSyncPlayView({ group: null });
    if (togetherState().mode === 'syncplay') setTogether({ mode: 'none', sync: null, waiting: false });
  }
}

let controller: SyncPlayController | null = null;

export function syncPlay(): SyncPlayController {
  controller ??= new SyncPlayController();
  return controller;
}
