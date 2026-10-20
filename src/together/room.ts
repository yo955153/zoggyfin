/**
 * The host side of a nearby session. The host is the clock and the only
 * authority: guests send requests, the host decides, changes its own player
 * and sends the new group state to everyone.
 *
 * A play starts `startLead` ms in the future, so every device can start at
 * the same moment. While any member buffers, the group waits (the host
 * pauses) and plays again when everyone is ready.
 */
import { positionAt } from './drift';
import type { Anchor, ControlAction, MediaKind, Member, Message, SharedItem, SharedQueue, StreamRef } from './protocol';
import type { PlayerPort, Timers } from './player-port';

/** The queue actions of an audio session. */
export type QueueAction = Extract<ControlAction, { action: 'next' | 'previous' | 'jump' | 'shuffle' | 'repeat' }>;

/** The host's audio queue, for an audio session (`audio-binding.ts`). */
export interface RoomQueue {
  snapshot(): SharedQueue;
  /** The key of the current queue entry. */
  track(): string | null;
  /** The player moved to another entry (the end of a track, or a queue action). */
  onTrack(listener: (key: string) => void): () => void;
  /** The order, the entries or the play modes changed. */
  onQueue(listener: () => void): () => void;
  apply(c: QueueAction): void;
}

export function isQueueAction(c: ControlAction): c is QueueAction {
  return c.action === 'next' || c.action === 'previous' || c.action === 'jump' || c.action === 'shuffle' || c.action === 'repeat';
}

/** A member that is away is removed after this long, ms. */
export const AWAY_LIMIT = 120_000;

export interface RoomDeps {
  send(message: Message, to?: string[]): void;
  /** Host monotonic clock, ms. */
  now(): number;
  player: PlayerPort;
  timers: Timers;
  /** Called after every change of members, policy or state (for the UI). */
  onChange?(): void;
  /** A guest asked for something it may not do. */
  onDenied?(peerId: string): void;
}

/** A member as the room keeps it: the public facts and the socket it uses now. */
interface RoomMember extends Member {
  peerId: string | null;
  awayTimer: unknown;
  /** A member that came back while the group plays: it catches up, the group does not wait for it. */
  catchingUp?: boolean;
}

export interface RoomOptions {
  sessionId: string;
  item: SharedItem;
  /** The host's stream, or null. */
  stream: StreamRef | null;
  onlyHostControls: boolean;
  startLead?: number;
  heartbeatMs?: number;
  kind?: MediaKind;
  /** Audio: the host's queue. */
  queue?: RoomQueue;
  /** The session key that members use to come back (link.ts). */
  key?: string;
  epoch?: number;
  /** The host's own member id. */
  hostId?: string;
  /** A new host: the anchor to start from (from its own player), and the members it takes over (all away until they come back). */
  anchor?: Anchor;
  members?: Member[];
}

export class HostRoom {
  private anchor: Anchor;
  private seq = 0;
  /** The group wants to play; it may still wait for a member that buffers. */
  private wantPlaying: boolean;
  private waiting = false;
  /** By member id. */
  private readonly members = new Map<string, RoomMember>();
  private readonly peerToMember = new Map<string, string>();
  private unsubQueue: (() => void)[] = [];
  readonly kind: MediaKind;
  readonly key: string | null;
  readonly epoch: number;
  readonly hostId: string | null;
  private readonly queue: RoomQueue | null;
  private hostBuffering = false;
  private startTimer: unknown = null;
  private heartbeat: unknown = null;
  private unsubBuffering: () => void;
  onlyHostControls: boolean;
  readonly sessionId: string;
  readonly item: SharedItem;
  private readonly stream: StreamRef | null;
  private readonly startLead: number;

  constructor(
    private readonly deps: RoomDeps,
    opts: RoomOptions,
  ) {
    this.sessionId = opts.sessionId;
    this.item = opts.item;
    this.stream = opts.stream;
    this.onlyHostControls = opts.onlyHostControls;
    this.startLead = opts.startLead ?? 300;
    this.kind = opts.kind ?? 'video';
    this.queue = opts.queue ?? null;
    this.key = opts.key ?? null;
    this.epoch = opts.epoch ?? 0;
    this.hostId = opts.hostId ?? null;
    const p = deps.player;
    this.wantPlaying = opts.anchor ? opts.anchor.playing : p.isPlaying();
    this.anchor = opts.anchor ?? { playing: p.isPlaying(), rate: 1, hostTime: deps.now(), position: p.position() };
    for (const m of opts.members ?? []) {
      this.members.set(m.id, { ...m, buffering: false, away: true, peerId: null, awayTimer: deps.timers.setTimeout(() => this.forget(m.id), AWAY_LIMIT) });
    }
    if (this.queue) {
      const q = this.queue;
      this.unsubQueue = [q.onTrack(() => this.trackChanged()), q.onQueue(() => this.broadcastQueue())];
    }
    this.unsubBuffering = p.onBuffering((b) => {
      this.hostBuffering = b;
      this.updateWaiting();
    });
    this.heartbeat = deps.timers.setInterval(() => this.beat(), opts.heartbeatMs ?? 2000);
  }

  get memberList(): Member[] {
    return [...this.members.values()].map(({ peerId: _p, awayTimer: _t, catchingUp: _c, ...m }) => m);
  }

  /** The member id of a socket, or null. */
  memberOf(peerId: string): string | null {
    return this.peerToMember.get(peerId) ?? null;
  }

  get state(): { anchor: Anchor; waiting: boolean; wantPlaying: boolean } {
    return { anchor: this.anchor, waiting: this.waiting, wantPlaying: this.wantPlaying };
  }

  /** A message from a connected guest. `receivedAt` is the host clock when it arrived. */
  receive(peerId: string, message: Message, receivedAt: number): void {
    switch (message.t) {
      case 'ping':
        this.deps.send({ t: 'pong', id: message.id, t0: message.t0, t1: receivedAt, t2: this.deps.now() }, [peerId]);
        return;
      case 'hello': {
        const local = message.have.includes(this.item.id);
        const id = message.memberId || peerId;
        const old = this.members.get(id);
        if (old) {
          this.deps.timers.clearTimeout(old.awayTimer);
          if (old.peerId && old.peerId !== peerId) this.peerToMember.delete(old.peerId);
        }
        // A member that comes back keeps its place (and its join time) for the host election.
        this.members.set(id, {
          id,
          name: message.name || 'Guest',
          local,
          buffering: true,
          joinedAt: old?.joinedAt ?? this.deps.now(),
          canHost: message.canHost ?? false,
          maker: message.maker ?? false,
          away: false,
          peerId,
          awayTimer: null,
          // Nobody pauses on a drop: a member that comes back while the group plays catches up.
          catchingUp: !!old && this.wantPlaying,
        });
        this.peerToMember.set(peerId, id);
        this.deps.send(
          {
            t: 'welcome',
            sessionId: this.sessionId,
            item: this.item,
            stream: this.stream,
            onlyHostControls: this.onlyHostControls,
            anchor: this.currentAnchor(),
            you: id,
            kind: this.kind,
            ...(this.queue ? { queue: this.queue.snapshot(), track: this.queue.track() ?? undefined } : {}),
            ...(this.key ? { key: this.key } : {}),
            epoch: this.epoch,
            ...(this.hostId ? { hostId: this.hostId } : {}),
          },
          [peerId],
        );
        this.broadcastMembers();
        // A new member loads the media: the group waits for it.
        this.updateWaiting();
        return;
      }
      case 'control':
        if (!this.peerToMember.has(peerId)) return;
        if (this.onlyHostControls) {
          this.deps.send({ t: 'denied', reason: 'Only the host controls playback.' }, [peerId]);
          this.deps.onDenied?.(peerId);
          return;
        }
        this.apply(message);
        return;
      case 'buffering': {
        const id = this.peerToMember.get(peerId);
        const m = id ? this.members.get(id) : undefined;
        if (!id || !m) return;
        this.members.set(id, {
          ...m,
          buffering: message.buffering,
          local: message.local,
          canHost: message.canHost ?? m.canHost,
          catchingUp: message.buffering ? m.catchingUp : false,
        });
        this.broadcastMembers();
        this.updateWaiting();
        return;
      }
      case 'leave': {
        const id = this.peerToMember.get(peerId);
        this.peerToMember.delete(peerId);
        if (id) this.forget(id);
        return;
      }
      default:
        return;
    }
  }

  /**
   * The link to a guest closed. The member stays in the list as away (the
   * group does not wait for it) and can come back with the session key.
   * After `AWAY_LIMIT` it is removed.
   */
  removeMember(peerId: string): void {
    const id = this.peerToMember.get(peerId);
    this.peerToMember.delete(peerId);
    const m = id ? this.members.get(id) : undefined;
    if (!id || !m || m.peerId !== peerId) return;
    this.members.set(id, { ...m, away: true, buffering: false, peerId: null, awayTimer: this.deps.timers.setTimeout(() => this.forget(id), AWAY_LIMIT) });
    this.broadcastMembers();
    this.updateWaiting();
  }

  /**
   * The host removes a member: it is told why, it leaves the list at once
   * and keeps no place. Returns the peer id of its socket (to close), or null.
   */
  expel(memberId: string, reason: string): string | null {
    const m = this.members.get(memberId);
    if (!m) return null;
    const peer = m.peerId;
    if (peer) this.deps.send({ t: 'removed', reason }, [peer]);
    this.forget(memberId);
    return peer;
  }

  private forget(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    this.deps.timers.clearTimeout(m.awayTimer);
    if (m.peerId) this.peerToMember.delete(m.peerId);
    this.members.delete(id);
    this.broadcastMembers();
    this.updateWaiting();
  }

  /** The sockets of the members that are connected now. */
  private get peers(): string[] {
    return [...this.members.values()].map((m) => m.peerId).filter((p): p is string => p !== null);
  }

  /** A control from the host's own player. */
  apply(c: ControlAction): void {
    const p = this.deps.player;
    const now = this.deps.now();
    if (isQueueAction(c)) {
      // The queue changes the player; the track and queue listeners tell the group.
      this.queue?.apply(c);
      return;
    }
    switch (c.action) {
      case 'play':
        this.wantPlaying = true;
        if (c.position !== undefined) p.seek(c.position);
        if (this.blocked()) {
          this.waiting = true;
          this.anchor = { ...this.anchor, playing: false, hostTime: now, position: c.position ?? p.position() };
          this.broadcastState();
          return;
        }
        this.scheduleStart(c.position ?? p.position());
        return;
      case 'pause': {
        this.wantPlaying = false;
        this.cancelStart();
        p.pause();
        const position = c.position ?? p.position();
        if (c.position !== undefined) p.seek(position);
        this.anchor = { ...this.anchor, playing: false, hostTime: now, position };
        this.waiting = false;
        this.broadcastState();
        return;
      }
      case 'seek': {
        const playing = this.anchor.playing || this.startTimer !== null;
        this.cancelStart();
        p.seek(c.position);
        if (playing && !this.blocked()) {
          this.scheduleStart(c.position);
          return;
        }
        this.anchor = { ...this.anchor, playing: false, hostTime: now, position: c.position };
        this.broadcastState();
        return;
      }
      case 'rate': {
        const position = this.currentAnchor().position;
        p.setRate(c.rate);
        this.anchor = { ...this.anchor, rate: c.rate, hostTime: now, position };
        this.broadcastState();
        return;
      }
    }
  }

  setOnlyHostControls(value: boolean): void {
    this.onlyHostControls = value;
    this.broadcastMembers();
  }

  /** Ends the session for everyone. */
  end(): void {
    this.deps.send({ t: 'end' });
    this.dispose();
  }

  dispose(): void {
    this.cancelStart();
    this.deps.timers.clearInterval(this.heartbeat);
    this.unsubBuffering();
    this.unsubQueue.forEach((u) => u());
    this.unsubQueue = [];
    for (const m of this.members.values()) this.deps.timers.clearTimeout(m.awayTimer);
  }

  /** Members that are away, or that came back and catch up, do not hold the group. */
  private blocked(): boolean {
    return this.hostBuffering || [...this.members.values()].some((m) => m.buffering && !m.away && !m.catchingUp);
  }

  /** Audio: the host's player moved to another queue entry. The new track starts at 0 now. */
  private trackChanged(): void {
    if (this.startTimer !== null) return;
    this.anchor = { ...this.anchor, hostTime: this.deps.now(), position: 0 };
    this.broadcastState();
  }

  private broadcastQueue(): void {
    if (!this.queue) return;
    this.seq += 1;
    if (this.peers.length) this.deps.send({ t: 'queue', seq: this.seq, queue: this.queue.snapshot() }, this.peers);
    this.deps.onChange?.();
  }

  private scheduleStart(position: number): void {
    const p = this.deps.player;
    const at = this.deps.now() + this.startLead;
    this.waiting = false;
    p.pause();
    p.seek(position);
    this.anchor = { ...this.anchor, playing: true, hostTime: at, position };
    this.broadcastState();
    this.cancelStart();
    this.startTimer = this.deps.timers.setTimeout(() => {
      this.startTimer = null;
      p.play();
    }, this.startLead);
  }

  private cancelStart(): void {
    if (this.startTimer !== null) this.deps.timers.clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private updateWaiting(): void {
    const blocked = this.blocked();
    if (blocked && this.wantPlaying && !this.waiting) {
      // Everyone waits for the member that buffers.
      this.cancelStart();
      const p = this.deps.player;
      p.pause();
      this.waiting = true;
      this.anchor = { ...this.anchor, playing: false, hostTime: this.deps.now(), position: p.position() };
      this.broadcastState();
    } else if (!blocked && this.waiting) {
      this.waiting = false;
      if (this.wantPlaying) this.scheduleStart(this.anchor.position);
      else this.broadcastState();
    } else {
      this.deps.onChange?.();
    }
  }

  /** The anchor at the host player's real position (it can drift from the plan). */
  private currentAnchor(): Anchor {
    const now = this.deps.now();
    if (this.anchor.playing && now >= this.anchor.hostTime && this.deps.player.isPlaying()) {
      return { ...this.anchor, hostTime: now, position: this.deps.player.position() };
    }
    return this.anchor.playing && now >= this.anchor.hostTime ? { ...this.anchor, hostTime: now, position: positionAt(this.anchor, now) } : this.anchor;
  }

  /** Re-anchors to the host player and repeats the state, so late or lost messages heal. */
  private beat(): void {
    if (this.startTimer !== null) return;
    this.anchor = this.currentAnchor();
    if (this.peers.length) this.broadcastState();
  }

  private broadcastState(): void {
    this.seq += 1;
    const track = this.queue?.track() ?? undefined;
    if (this.peers.length) this.deps.send({ t: 'state', seq: this.seq, anchor: this.anchor, waiting: this.waiting, ...(track ? { track } : {}) }, this.peers);
    this.deps.onChange?.();
  }

  private broadcastMembers(): void {
    if (this.peers.length) this.deps.send({ t: 'members', members: this.memberList, onlyHostControls: this.onlyHostControls }, this.peers);
    this.deps.onChange?.();
  }
}
