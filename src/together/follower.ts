/**
 * The guest side of a nearby session. The follower keeps the clock offset
 * to the host (ping/pong), follows the group state through an
 * AnchorFollower, and sends the guest's controls and buffering to the host.
 */
import { AnchorFollower, type SyncSample } from './anchor-follower';
import { ClockSync, type ClockEstimate } from './clock';
import { DEFAULT_DRIFT, type DriftOptions } from './drift';
import type { Anchor, ControlAction, MediaKind, Member, Message, SharedQueue } from './protocol';
import type { PlayerPort, Timers } from './player-port';

export type { SyncSample } from './anchor-follower';

export interface FollowerDeps {
  send(message: Message): void;
  /** Local monotonic clock, ms. */
  now(): number;
  timers: Timers;
  onChange?(): void;
  /** The host said no to a control. */
  onDenied?(reason: string): void;
  /** Called on each drift check, for measurements. */
  onSample?(sample: SyncSample): void;
  /** Audio: the host's queue (from the welcome, and after each change). */
  onQueue?(queue: SharedQueue): void;
  /** Audio: the player is on another queue entry than the group. */
  onTrackMismatch?(track: string, anchor: Anchor): void;
}

/** What the host told this guest about the session (for reconnects and the election). */
export interface SessionFacts {
  sessionId: string;
  key: string | null;
  epoch: number;
  hostId: string | null;
  kind: MediaKind;
  selfId: string | null;
}

export interface FollowerStats {
  clock: ClockEstimate | null;
  /** The last measured drift, seconds (positive: this device is behind). */
  drift: number | null;
  corrections: { rate: number; seek: number };
}

const BURST = 8;
const BURST_GAP = 120;
const PING_EVERY = 2000;
const TICK = 500;

export class Follower {
  private clock = new ClockSync();
  private anchors: AnchorFollower;
  private waiting = false;
  private seq = -1;
  private pingId = 0;
  private pending = new Set<number>();
  private timers: unknown[] = [];
  private unsubBuffering: (() => void) | null = null;
  /** The other guests (this guest is left out). */
  members: Member[] = [];
  /** Every guest, this guest too (for the host election). */
  allMembers: Member[] = [];
  facts: SessionFacts | null = null;
  queue: SharedQueue | null = null;
  private selfId: string | null = null;
  onlyHostControls = false;
  private local = false;
  private hello: { name: string; have: string[]; extra: { memberId?: string; canHost?: boolean; maker?: boolean } } | null = null;

  constructor(
    private readonly deps: FollowerDeps,
    drift: DriftOptions = DEFAULT_DRIFT,
  ) {
    this.anchors = new AnchorFollower(
      { now: deps.now, remoteNow: () => this.hostNow(), timers: deps.timers, onSample: deps.onSample, onTrackMismatch: deps.onTrackMismatch },
      drift,
    );
  }

  /** Sends hello and starts the clock sync. */
  start(name: string, have: string[], extra: { memberId?: string; canHost?: boolean; maker?: boolean } = {}): void {
    this.hello = { name, have, extra };
    this.deps.send({ t: 'hello', name, have, ...extra });
    for (let i = 0; i < BURST; i++) this.timers.push(this.deps.timers.setTimeout(() => this.ping(), i * BURST_GAP));
    this.timers.push(this.deps.timers.setInterval(() => this.ping(), PING_EVERY));
    this.timers.push(this.deps.timers.setInterval(() => this.anchors.follow(false), TICK));
  }

  /** The player is loaded and ready to follow. `local`: it plays its own copy. */
  private player: PlayerPort | null = null;

  attach(player: PlayerPort, local: boolean): void {
    this.unsubBuffering?.();
    this.player = player;
    this.local = local;
    this.unsubBuffering = player.onBuffering((b) => this.deps.send({ t: 'buffering', buffering: b, local: this.local }));
    this.deps.send({ t: 'buffering', buffering: player.isBuffering(), local });
    this.anchors.attach(player);
  }

  get stats(): FollowerStats {
    return { clock: this.clock.estimate(), drift: this.anchors.lastDrift, corrections: { ...this.anchors.corrections } };
  }

  get groupAnchor(): Anchor | null {
    return this.anchors.current;
  }

  get groupTrack(): string | null {
    return this.anchors.currentTrack;
  }

  /** The offset to the host clock (host minus local, ms), or null. */
  get offset(): number | null {
    return this.clock.estimate()?.offset ?? null;
  }

  /**
   * The link to the host is back (the same host), or a new host took over.
   * Sends hello again on the new link. With a new host the clock starts
   * again: until the first pongs the player plays on as it is.
   */
  relink(send: (m: Message) => void, newHost: boolean, extra?: { canHost?: boolean }): void {
    this.deps.send = send;
    this.seq = -1;
    this.pending.clear();
    if (newHost) this.clock = new ClockSync();
    if (this.hello) this.deps.send({ t: 'hello', name: this.hello.name, have: this.hello.have, ...this.hello.extra, ...extra });
    // The player plays already: tell the host at once, so the group does not wait for this device.
    if (this.player) this.deps.send({ t: 'buffering', buffering: this.player.isBuffering(), local: this.local, ...(extra?.canHost !== undefined ? { canHost: extra.canHost } : {}) });
    for (let i = 0; i < BURST; i++) this.timers.push(this.deps.timers.setTimeout(() => this.ping(), i * BURST_GAP));
  }

  /** The player state now changes only with local controls (this device is the new host). Keeps the player. */
  release(): PlayerPort | null {
    const p = this.player;
    this.dispose();
    return p;
  }

  get isWaiting(): boolean {
    return this.waiting;
  }

  /** Host clock now, or null before the first pong. */
  hostNow(): number | null {
    const e = this.clock.estimate();
    return e ? this.deps.now() + e.offset : null;
  }

  receive(message: Message, receivedAt: number): void {
    switch (message.t) {
      case 'pong':
        if (!this.pending.delete(message.id)) return;
        this.clock.add({ t0: message.t0, t1: message.t1, t2: message.t2, t3: receivedAt });
        if (this.clock.count === 3) this.anchors.follow(true);
        this.deps.onChange?.();
        return;
      case 'welcome':
        this.selfId = message.you ?? null;
        this.onlyHostControls = message.onlyHostControls;
        this.facts = {
          sessionId: message.sessionId,
          key: message.key ?? null,
          epoch: message.epoch ?? 0,
          hostId: message.hostId ?? null,
          kind: message.kind ?? 'video',
          selfId: this.selfId,
        };
        if (message.queue) {
          this.queue = message.queue;
          this.deps.onQueue?.(message.queue);
        }
        this.anchors.setAnchor(message.anchor, message.track ?? null);
        this.deps.onChange?.();
        return;
      case 'state':
        if (message.seq <= this.seq) return;
        this.seq = message.seq;
        this.waiting = message.waiting;
        this.anchors.setAnchor(message.anchor, message.track ?? (this.queue ? this.anchors.currentTrack : null));
        this.deps.onChange?.();
        return;
      case 'queue':
        if (message.seq <= this.seq) return;
        this.seq = message.seq;
        this.queue = message.queue;
        this.deps.onQueue?.(message.queue);
        this.deps.onChange?.();
        return;
      case 'members':
        this.allMembers = message.members;
        this.members = message.members.filter((m) => m.id !== this.selfId);
        this.onlyHostControls = message.onlyHostControls;
        this.deps.onChange?.();
        return;
      case 'denied':
        this.deps.onDenied?.(message.reason);
        return;
      default:
        return;
    }
  }

  /** A control from this guest's own player UI. False when the host does not allow it. */
  request(c: ControlAction): boolean {
    if (this.onlyHostControls) {
      this.deps.onDenied?.('Only the host controls playback.');
      return false;
    }
    this.deps.send({ t: 'control', ...c });
    return true;
  }

  leave(): void {
    this.deps.send({ t: 'leave' });
    this.dispose();
  }

  dispose(): void {
    for (const t of this.timers) {
      this.deps.timers.clearTimeout(t);
      this.deps.timers.clearInterval(t);
    }
    this.timers = [];
    this.anchors.detach();
    this.unsubBuffering?.();
    this.unsubBuffering = null;
  }

  private ping(): void {
    const id = ++this.pingId;
    this.pending.add(id);
    if (this.pending.size > 32) this.pending.delete(this.pending.values().next().value as number);
    this.deps.send({ t: 'ping', id, t0: this.deps.now() });
  }
}
