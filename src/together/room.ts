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
import type { Anchor, ControlAction, Member, Message, SharedItem, StreamRef } from './protocol';
import type { PlayerPort, Timers } from './player-port';

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

export interface RoomOptions {
  sessionId: string;
  item: SharedItem;
  /** The host's stream, or null. */
  stream: StreamRef | null;
  onlyHostControls: boolean;
  startLead?: number;
  heartbeatMs?: number;
}

export class HostRoom {
  private anchor: Anchor;
  private seq = 0;
  /** The group wants to play; it may still wait for a member that buffers. */
  private wantPlaying: boolean;
  private waiting = false;
  private readonly members = new Map<string, Member>();
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
    const p = deps.player;
    this.wantPlaying = p.isPlaying();
    this.anchor = { playing: p.isPlaying(), rate: 1, hostTime: deps.now(), position: p.position() };
    this.unsubBuffering = p.onBuffering((b) => {
      this.hostBuffering = b;
      this.updateWaiting();
    });
    this.heartbeat = deps.timers.setInterval(() => this.beat(), opts.heartbeatMs ?? 2000);
  }

  get memberList(): Member[] {
    return [...this.members.values()];
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
        this.members.set(peerId, { id: peerId, name: message.name || 'Guest', local, buffering: true });
        this.deps.send(
          {
            t: 'welcome',
            sessionId: this.sessionId,
            item: this.item,
            stream: this.stream,
            onlyHostControls: this.onlyHostControls,
            anchor: this.currentAnchor(),
            you: peerId,
          },
          [peerId],
        );
        this.broadcastMembers();
        // A new member loads the media: the group waits for it.
        this.updateWaiting();
        return;
      }
      case 'control':
        if (!this.members.has(peerId)) return;
        if (this.onlyHostControls) {
          this.deps.send({ t: 'denied', reason: 'Only the host controls playback.' }, [peerId]);
          this.deps.onDenied?.(peerId);
          return;
        }
        this.apply(message);
        return;
      case 'buffering': {
        const m = this.members.get(peerId);
        if (!m) return;
        this.members.set(peerId, { ...m, buffering: message.buffering, local: message.local });
        this.broadcastMembers();
        this.updateWaiting();
        return;
      }
      case 'leave':
        this.removeMember(peerId);
        return;
      default:
        return;
    }
  }

  /** The link to a guest closed. */
  removeMember(peerId: string): void {
    if (!this.members.delete(peerId)) return;
    this.broadcastMembers();
    this.updateWaiting();
  }

  /** A control from the host's own player. */
  apply(c: ControlAction): void {
    const p = this.deps.player;
    const now = this.deps.now();
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
  }

  private blocked(): boolean {
    return this.hostBuffering || [...this.members.values()].some((m) => m.buffering);
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
    if (this.members.size) this.broadcastState();
  }

  private broadcastState(): void {
    this.seq += 1;
    if (this.members.size) this.deps.send({ t: 'state', seq: this.seq, anchor: this.anchor, waiting: this.waiting });
    this.deps.onChange?.();
  }

  private broadcastMembers(): void {
    if (this.members.size) this.deps.send({ t: 'members', members: this.memberList, onlyHostControls: this.onlyHostControls });
    this.deps.onChange?.();
  }
}
