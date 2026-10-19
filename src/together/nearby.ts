/**
 * Nearby mode: watch together with no internet. The host shares a
 * downloaded item; guests nearby find the session, ask to join and play
 * either their own download of the same item or the host's file over the
 * peer link. Multipeer carries the session messages (see protocol.ts).
 */
import { router } from 'expo-router';
import { Platform } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { type DownloadRecord, findDownload, localFileFor } from '@/downloads';
import { randomId } from '@/lib/id';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';
import { controlGate, type UserControl } from '@/player/control-gate';
import { videoSession } from '@/player/session';
import { playerState } from '@/player/store';

import { Follower } from './follower';
import { IDLE, type PhaseEvent, transition } from './machine';
import { matchesShared } from './match';
import { nearbyNative } from './nearby-native';
import type { NearbyNative } from './nearby-native-types';
import { bindVideoPort, type BoundPort, whenPlayerReady } from './player-binding';
import { realTimers } from './player-port';
import { decode, decodeAdvert, decodeJoinContext, encode, encodeAdvert, encodeJoinContext, type Message, type SharedItem } from './protocol';
import { HostRoom } from './room';
import { openTogetherSheet, setTogether, togetherState } from './store';
import { syncLog } from './sync-log';

/** True where nearby mode can run: the native app with the module, not TV. */
export const nearbySupported: boolean = Platform.OS === 'ios' && features.watchTogether && nearbyNative !== null;

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);

/**
 * A completed download whose file is on this device, from any saved server
 * (nearby mode never needs the active account). With a server Id, the
 * download must come from that server (see match.ts).
 */
function localRecord(itemId: string | null | undefined, serverId?: string | null): DownloadRecord | null {
  const r = findDownload(itemId);
  if (!r || !itemId || !matchesShared(r, { id: itemId, serverId })) return null;
  return localFileFor(r.itemId) ? r : null;
}

/** The host can share this item: a downloaded video. */
export function canHostNearby(item: BaseItemDto | null | undefined): boolean {
  return nearbySupported && !!item && VIDEO_TYPES.has(item.Type ?? '') && localRecord(item.Id) !== null;
}

function displayName(): string {
  const user = useSessionStore.getState().session?.userName;
  const device = clientIdentity().device;
  return user ? `${user} · ${device}` : device;
}

function mimeFor(ext: string): string {
  switch (ext) {
    case 'mov':
      return 'video/quicktime';
    case 'm4v':
      return 'video/x-m4v';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    default:
      return 'video/mp4';
  }
}

function sharedItem(item: BaseItemDto, r: DownloadRecord): SharedItem {
  return {
    id: r.itemId,
    serverId: r.serverId || null,
    name: item.Name ?? 'Video',
    type: item.Type ?? 'Video',
    seriesName: item.SeriesName ?? null,
    runTimeTicks: item.RunTimeTicks ?? null,
    mediaSourceId: r.mediaSourceId,
    container: r.mediaFile.split('.').pop() ?? 'mp4',
  };
}

function toBaseItem(s: SharedItem): BaseItemDto {
  return { Id: s.id, Name: s.name, Type: s.type as BaseItemDto['Type'], SeriesName: s.seriesName ?? undefined, RunTimeTicks: s.runTimeTicks ?? undefined };
}

function pathOf(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

class NearbyController {
  private native: NearbyNative | null = nearbyNative;
  private subs: { remove(): void }[] = [];
  private room: HostRoom | null = null;
  private follower: Follower | null = null;
  private port: BoundPort | null = null;
  private hostPeerId: string | null = null;
  /** The item of the session a guest asked to join (from the advert). */
  private joinItemId: string | null = null;
  private joinServerId: string | null = null;
  private loadToken = 0;
  /** Development (together-lab): stream from the host even with a local copy. */
  devForceStream = false;

  private dispatch(event: PhaseEvent): void {
    const phase = transition(togetherState().phase, event);
    if (phase !== togetherState().phase) setTogether({ phase });
  }

  private listen(): void {
    const n = this.native;
    if (!n || this.subs.length) return;
    this.subs = [
      n.on('onPeerFound', (e) => {
        const advert = decodeAdvert(e.info);
        if (!advert) return;
        const hosts = togetherState().hosts.filter((h) => h.peerId !== e.peerId);
        setTogether({ hosts: [...hosts, { peerId: e.peerId, advert }] });
      }),
      n.on('onPeerLost', (e) => setTogether({ hosts: togetherState().hosts.filter((h) => h.peerId !== e.peerId) })),
      n.on('onInvitation', (e) => {
        if (!this.room) {
          n.respond(e.inviteId, false);
          return;
        }
        const ctx = decodeJoinContext(e.context);
        const req = { inviteId: e.inviteId, peerId: e.peerId, name: ctx?.name ?? e.name, have: ctx?.have ?? false };
        setTogether({ requests: [...togetherState().requests.filter((r) => r.peerId !== e.peerId), req] });
        toast(`${req.name} wants to watch with you`, { icon: 'person.2.fill', action: { label: 'View', onPress: () => openTogetherSheet('player', null) } });
      }),
      n.on('onPeerState', (e) => {
        if (this.room) {
          if (e.state === 'notConnected') this.room.removeMember(e.peerId);
          return;
        }
        if (e.state === 'connected' && togetherState().phase.name === 'requesting') {
          this.dispatch({ type: 'CONNECTED', peerId: e.peerId });
          if (togetherState().phase.name === 'syncing') this.startFollower();
        } else if (e.state === 'notConnected') {
          const before = togetherState().phase.name;
          this.dispatch({ type: 'DISCONNECTED', peerId: e.peerId });
          const after = togetherState().phase;
          if (before === 'requesting' && after.name === 'browsing') setTogether({ notice: after.notice ?? null });
          if (after.name === 'ended') this.closeGuest(after.message);
        }
      }),
      n.on('onMessage', (e) => {
        const m = decode(e.text);
        if (!m) return;
        if (this.room) this.room.receive(e.peerId, m, e.receivedAt);
        else if (this.follower && e.peerId === this.hostPeerId) this.onHostMessage(m, e.receivedAt);
      }),
      n.on('onError', (e) => setTogether({ notice: e.message })),
    ];
  }

  private unlisten(): void {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }

  private send = (message: Message, to?: string[]) => {
    this.native?.send(encode(message), to ?? null, message.t !== 'ping' && message.t !== 'pong');
  };

  private now = () => this.native?.monotonicNow() ?? Date.now();

  // ---- Host ----------------------------------------------------------------

  /** Starts a session for a downloaded item. Starts the player (paused) when it plays something else. */
  async host(item: BaseItemDto): Promise<void> {
    const n = this.native;
    const r = localRecord(item.Id);
    if (!n || !r) {
      toast('Download this item first to watch it together nearby.');
      return;
    }
    if (togetherState().mode !== 'none') await this.stopAll();
    const uri = localFileFor(r.itemId)!;
    const st = playerState();
    if (st.now?.item.Id !== r.itemId) {
      const start = (r.item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
      void videoSession().playSource({ item: r.item, uri, startSeconds: start, autoplay: false, record: r });
      router.navigate('/player');
      await whenPlayerReady();
    }
    let stream: { service: string; path: string } | null = null;
    try {
      const server = await n.startMediaServer();
      const ext = r.mediaFile.split('.').pop() ?? 'mp4';
      const path = `/${randomId().replace(/-/g, '')}/media.${ext}`;
      n.shareFile(path, pathOf(uri), mimeFor(ext));
      stream = { service: server.service, path };
    } catch (e) {
      console.warn('[together] media server failed', e);
    }
    const sessionId = randomId();
    const shared = sharedItem(item, r);
    this.listen();
    this.port = bindVideoPort((c) => this.room?.apply(c));
    this.room = new HostRoom(
      {
        send: this.send,
        now: this.now,
        player: this.port,
        timers: realTimers,
        onChange: () => this.publishHost(),
        onDenied: () => undefined,
      },
      { sessionId, item: shared, stream, onlyHostControls: togetherState().onlyHostControls },
    );
    n.startHosting(displayName(), encodeAdvert({ sessionId, hostName: displayName(), itemId: shared.id, itemName: shared.name, serverId: shared.serverId ?? null }));
    setTogether({ mode: 'nearby', role: 'host', item: shared, hostName: displayName(), phase: IDLE, requests: [], notice: null });
    this.dispatch({ type: 'HOST', sessionId });
    controlGate.set((c) => {
      this.room?.apply(c);
      return true;
    });
    syncLog.start('host', () => ({ pos: this.port?.position() ?? 0, playing: this.port?.isPlaying() ?? false }), this.now);
    this.publishHost();
  }

  private publishHost(): void {
    const room = this.room;
    if (!room) return;
    setTogether({ members: room.memberList, waiting: room.state.waiting, onlyHostControls: room.onlyHostControls });
  }

  respond(inviteId: string, accept: boolean): void {
    this.native?.respond(inviteId, accept);
    setTogether({ requests: togetherState().requests.filter((r) => r.inviteId !== inviteId) });
  }

  setOnlyHostControls(value: boolean): void {
    setTogether({ onlyHostControls: value });
    this.room?.setOnlyHostControls(value);
  }

  // ---- Guest ---------------------------------------------------------------

  browse(): void {
    const n = this.native;
    if (!n) return;
    if (togetherState().mode === 'nearby' && togetherState().role === 'host') return;
    this.listen();
    setTogether({ mode: 'nearby', role: 'guest', hosts: [], notice: null, phase: IDLE });
    this.dispatch({ type: 'BROWSE' });
    n.startBrowsing(displayName());
  }

  /** Sends a join request to a host found nearby. */
  join(peerId: string): void {
    const n = this.native;
    const host = togetherState().hosts.find((h) => h.peerId === peerId);
    if (!n || !host) return;
    const have = localRecord(host.advert.itemId, host.advert.serverId) !== null;
    this.joinItemId = host.advert.itemId;
    this.joinServerId = host.advert.serverId;
    this.dispatch({ type: 'REQUEST', hostPeerId: peerId, hostName: host.advert.hostName });
    setTogether({ notice: null, hostName: host.advert.hostName });
    if (!n.invite(peerId, encodeJoinContext({ name: displayName(), have }))) {
      this.dispatch({ type: 'DISCONNECTED', peerId });
      setTogether({ notice: 'The session is no longer there.' });
    }
  }

  private startFollower(): void {
    const phase = togetherState().phase;
    if (phase.name !== 'syncing') return;
    this.hostPeerId = phase.hostPeerId;
    this.native?.stopBrowsing();
    const f = new Follower({
      send: (m) => this.send(m, this.hostPeerId ? [this.hostPeerId] : undefined),
      now: this.now,
      timers: realTimers,
      onChange: () => this.publishGuest(),
      onDenied: (reason) => {
        setTogether({ notice: reason });
        toast(reason, { icon: 'lock.fill' });
      },
      onSample: (s) => syncLog.sample(s),
    });
    this.follower = f;
    const id = this.joinItemId;
    f.start(displayName(), id && localRecord(id, this.joinServerId) ? [id] : []);
  }

  private publishGuest(): void {
    const f = this.follower;
    if (!f) return;
    const st = f.stats;
    setTogether({
      members: f.members,
      onlyHostControls: f.onlyHostControls,
      waiting: f.isWaiting,
      sync: st.clock ? { offset: st.clock.offset, rtt: st.clock.rtt, drift: st.drift === null ? null : st.drift * 1000 } : null,
    });
  }

  private onHostMessage(m: Message, receivedAt: number): void {
    const f = this.follower;
    if (!f) return;
    f.receive(m, receivedAt);
    if (m.t === 'welcome') {
      this.dispatch({ type: 'WELCOME', sessionId: m.sessionId });
      setTogether({ item: m.item, onlyHostControls: m.onlyHostControls });
      void this.loadGuestMedia(m.item, m.stream);
    } else if (m.t === 'end') {
      this.dispatch({ type: 'HOST_ENDED' });
      const p = togetherState().phase;
      this.closeGuest(p.name === 'ended' ? p.message : 'The session ended.');
    }
  }

  private async loadGuestMedia(item: SharedItem, stream: { service: string; path: string } | null): Promise<void> {
    const n = this.native;
    const f = this.follower;
    if (!n || !f) return;
    const token = ++this.loadToken;
    const hostNow = f.hostNow();
    const anchor = f.groupAnchor;
    const start = anchor ? anchor.position + (anchor.playing && hostNow !== null ? Math.max(0, (hostNow - anchor.hostTime) / 1000) * anchor.rate : 0) : 0;
    const r = this.devForceStream ? null : localRecord(item.id, item.serverId);
    let uri: string;
    if (r) {
      uri = localFileFor(r.itemId)!;
      setTogether({ source: 'local' });
    } else if (stream) {
      try {
        const port = await n.startRelay(stream.service);
        uri = `http://127.0.0.1:${port}${stream.path}`;
        setTogether({ source: 'stream' });
      } catch {
        this.failGuest('Could not open the stream from the host.');
        return;
      }
    } else {
      this.failGuest('The host cannot share this item.');
      return;
    }
    if (token !== this.loadToken) return;
    void videoSession().playSource({ item: toBaseItem(item), uri, startSeconds: start, autoplay: false, record: r });
    router.navigate('/player');
    const ok = await whenPlayerReady(30_000);
    if (token !== this.loadToken || this.follower !== f) return;
    if (!ok) {
      this.failGuest('The video could not be played.');
      return;
    }
    this.port = bindVideoPort((c) => {
      if (!f.request(c)) this.revertOutside(c);
    });
    controlGate.set((c) => {
      f.request(c);
      return true;
    });
    f.attach(this.port, r !== null);
    syncLog.start('guest', () => ({ pos: this.port?.position() ?? 0, playing: this.port?.isPlaying() ?? false }), this.now);
  }

  /** A guest that may not control: undo a change from the lock screen. */
  private revertOutside(c: UserControl): void {
    if (c.action === 'play') this.port?.pause();
    else if (c.action === 'pause') this.port?.play();
  }

  private failGuest(message: string): void {
    this.dispatch({ type: 'FAIL', message });
    this.closeGuest(message);
  }

  /** The guest's session is over: stop following, keep the state for the sheet. */
  private closeGuest(message: string): void {
    const streaming = togetherState().source === 'stream';
    this.teardownGuest();
    if (streaming) void videoSession().stop();
    else this.port?.pause();
    setTogether({ notice: message });
    toast(message, { icon: 'person.2.slash' });
  }

  private teardownGuest(): void {
    this.loadToken++;
    this.follower?.dispose();
    this.follower = null;
    this.hostPeerId = null;
    controlGate.set(null);
    this.port?.dispose();
    syncLog.stop();
    this.native?.stopRelay();
    this.native?.stop();
  }

  // ---- Both ----------------------------------------------------------------

  /** Host: ends the session for everyone. Guest: leaves. */
  async stopAll(): Promise<void> {
    const n = this.native;
    if (this.room) {
      this.room.end();
      this.room = null;
      // Let the end message leave before the link closes.
      await new Promise((r) => setTimeout(r, 300));
      n?.stopMediaServer();
      n?.stop();
      controlGate.set(null);
      this.port?.dispose();
      this.port = null;
      syncLog.stop();
    } else if (this.follower) {
      const streaming = togetherState().source === 'stream';
      this.follower.leave();
      await new Promise((r) => setTimeout(r, 200));
      this.teardownGuest();
      if (streaming) void videoSession().stop();
    } else {
      n?.stop();
    }
    this.unlisten();
    setTogether({
      mode: 'none',
      role: null,
      phase: IDLE,
      item: null,
      members: [],
      requests: [],
      hosts: [],
      sync: null,
      waiting: false,
      source: null,
      hostName: null,
    });
  }

  /** Clears an ended session from the sheet. */
  dismiss(): void {
    if (this.room || this.follower) return;
    void this.stopAll();
  }

  mediaStats() {
    return this.native?.mediaStats() ?? null;
  }
}

let controller: NearbyController | null = null;

export function nearby(): NearbyController {
  controller ??= new NearbyController();
  return controller;
}
