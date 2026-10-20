/**
 * The nearby link: the handshake on top of the native transport
 * (`link-native-types.ts`), shared by every platform.
 *
 * Host: opens the session port, advertises it, and gets control sockets
 * from guests. A guest's first frame is `join` (name, has a copy, maybe a
 * key). The host accepts or declines; a guest with the correct session key
 * (it comes back after a drop, or it follows a new host) gets in with no new
 * approval. Only accepted sockets carry session messages (protocol.ts).
 *
 * Guest: finds services (Bonjour / NSD), connects to one (or to an address
 * from a join code), sends `join` and waits for `accept`.
 *
 * Peer ids are the socket ids of the native transport.
 */
import type { NearbyLinkNative } from './link-native-types';
import type { Timers } from './player-port';
import { decode, decodeLink, encode, encodeLink, type JoinContext, type Message } from './protocol';

export type JoinTarget = { serviceId: string } | { host: string; port: number };

export interface LinkHandlers {
  /** Host: a guest asks to join. `code`: it sent the key of the host's join code. A guest with the session key gets in with no request. */
  onRequest?(e: { peerId: string; ctx: JoinContext; code: boolean }): void;
  /** Host: an accepted guest. Guest: the host accepted this device. */
  onPeerUp?(peerId: string, ctx: JoinContext | null): void;
  /** A peer's socket closed (or a guest's join failed). `declined`: the host said no. */
  onPeerDown?(peerId: string, e: { declined: boolean; reason: string | null; wasUp: boolean }): void;
  onMessage?(peerId: string, message: Message, receivedAt: number): void;
  onServiceFound?(e: { serviceId: string; txt: Record<string, string> }): void;
  onServiceLost?(serviceId: string): void;
  onError?(e: { message: string; code?: string }): void;
}

export interface LinkOptions {
  /** Host: the full session key. A join with it is accepted at once. */
  sessionKey?: () => string | null;
  /** Host: true when a key is the key of the host's join code (the guest scanned or typed it). */
  isCodeKey?: (key: string) => boolean;
  /** Guest: how long to wait for the host's answer, ms. */
  joinTimeout?: number;
  /**
   * Host: the join gate (join-gate.ts). Runs on every join before the host
   * sees it. `withKey`: the guest sent the correct session key. Returns
   * `ok` (a key holder gets in), `ask` (the host decides) or a refusal text
   * (the guest gets it at once and the socket closes).
   */
  admit?: (e: { peerId: string; ctx: JoinContext; withKey: boolean }) => 'ok' | 'ask' | { refuse: string };
}

type PeerState = { kind: 'pending-in'; ctx: JoinContext | null } | { kind: 'pending-out'; ctx: JoinContext; timer: unknown } | { kind: 'up'; ctx: JoinContext | null };

export class NearbyLink {
  private subs: { remove(): void }[] = [];
  private peers = new Map<string, PeerState>();
  private handlers: LinkHandlers = {};

  constructor(
    readonly native: NearbyLinkNative,
    private readonly timers: Timers,
    private readonly opts: LinkOptions = {},
  ) {}

  setHandlers(h: LinkHandlers): void {
    this.handlers = h;
  }

  /** Starts to listen to the native events (once). */
  open(): void {
    if (this.subs.length) return;
    const n = this.native;
    this.subs = [
      n.on('onSocketOpen', (e) => this.opened(e.socketId, e.inbound)),
      n.on('onFrame', (e) => this.frame(e.socketId, e.text, e.receivedAt)),
      n.on('onSocketClosed', (e) => this.closed(e.socketId, e.reason)),
      n.on('onServiceFound', (e) => this.handlers.onServiceFound?.({ serviceId: e.serviceId, txt: e.txt })),
      n.on('onServiceLost', (e) => this.handlers.onServiceLost?.(e.serviceId)),
      n.on('onError', (e) => this.handlers.onError?.(e)),
    ];
  }

  /** Stops listening and closes every socket. */
  close(): void {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }

  get upPeers(): string[] {
    return [...this.peers.entries()].filter(([, p]) => p.kind === 'up').map(([id]) => id);
  }

  isUp(peerId: string): boolean {
    return this.peers.get(peerId)?.kind === 'up';
  }

  // ---- Host ---------------------------------------------------------------------

  /** Host: accepts or declines a join request. `reason`: the text the guest sees on a decline. */
  respond(peerId: string, accept: boolean, reason?: string): void {
    const p = this.peers.get(peerId);
    if (!p || p.kind !== 'pending-in') return;
    if (accept) {
      this.peers.set(peerId, { kind: 'up', ctx: p.ctx });
      this.native.send(peerId, encodeLink({ t: 'accept' }));
      this.handlers.onPeerUp?.(peerId, p.ctx);
    } else {
      this.refuse(peerId, reason ?? 'The host did not let you join.');
    }
  }

  /** Host: sends a decline and closes the socket a moment later. */
  private refuse(peerId: string, reason: string): void {
    this.native.send(peerId, encodeLink({ t: 'decline', reason }));
    this.peers.delete(peerId);
    // Let the answer leave before the socket closes.
    this.timers.setTimeout(() => this.native.close(peerId), 300);
  }

  // ---- Guest --------------------------------------------------------------------

  /** Guest: opens a socket to a host and asks to join. Returns the peer id. */
  join(target: JoinTarget, ctx: JoinContext): string {
    const id = 'serviceId' in target ? this.native.connect(target.serviceId) : this.native.connectAddress(target.host, target.port);
    const timer = this.timers.setTimeout(() => {
      const p = this.peers.get(id);
      if (p?.kind !== 'pending-out') return;
      this.peers.delete(id);
      this.native.close(id);
      this.handlers.onPeerDown?.(id, { declined: false, reason: 'The host did not answer.', wasUp: false });
    }, this.opts.joinTimeout ?? 120_000);
    this.peers.set(id, { kind: 'pending-out', ctx, timer });
    return id;
  }

  // ---- Both ---------------------------------------------------------------------

  /** Sends a session message to some accepted peers, or to all of them. A broadcast is one native call when the build can. */
  send(message: Message, to?: string[] | null): void {
    const text = encode(message);
    const ids = (to ?? this.upPeers).filter((id) => this.isUp(id));
    if (ids.length > 1 && this.native.sendMany) {
      this.native.sendMany(ids, text);
      return;
    }
    for (const id of ids) this.native.send(id, text);
  }

  /** Host: answers a ping. `t2` is stamped in native code when the build can (link-native-types.ts). */
  sendPong(peerId: string, id: number, t0: number, t1: number): void {
    if (!this.isUp(peerId)) return;
    if (this.native.sendPong) {
      this.native.sendPong(peerId, id, t0, t1);
      return;
    }
    this.native.send(peerId, encode({ t: 'pong', id, t0, t1, t2: this.native.monotonicNow() }));
  }

  /** Closes one peer's socket with no event. */
  drop(peerId: string): void {
    const p = this.peers.get(peerId);
    if (p?.kind === 'pending-out') this.timers.clearTimeout(p.timer);
    this.peers.delete(peerId);
    this.native.close(peerId);
  }

  // ---- Native events --------------------------------------------------------------

  private opened(socketId: string, inbound: boolean): void {
    if (inbound) {
      this.peers.set(socketId, { kind: 'pending-in', ctx: null });
      return;
    }
    const p = this.peers.get(socketId);
    if (p?.kind === 'pending-out') this.native.send(socketId, encodeLink({ t: 'join', ctx: p.ctx }));
  }

  private frame(socketId: string, text: string, receivedAt: number): void {
    const p = this.peers.get(socketId);
    if (!p) return;
    if (p.kind === 'up') {
      const m = decode(text);
      if (m) this.handlers.onMessage?.(socketId, m, receivedAt);
      return;
    }
    const l = decodeLink(text);
    if (!l) return;
    if (p.kind === 'pending-in' && l.t === 'join' && p.ctx === null) {
      const key = l.ctx.key;
      const sessionKey = this.opts.sessionKey?.() ?? null;
      const withKey = !!key && !!sessionKey && key === sessionKey;
      const verdict = this.opts.admit?.({ peerId: socketId, ctx: l.ctx, withKey }) ?? (withKey ? 'ok' : 'ask');
      if (typeof verdict === 'object') {
        this.refuse(socketId, verdict.refuse);
        return;
      }
      if (withKey && verdict === 'ok') {
        // A member that comes back, or one that follows this new host.
        this.peers.set(socketId, { kind: 'up', ctx: l.ctx });
        this.native.send(socketId, encodeLink({ t: 'accept' }));
        this.handlers.onPeerUp?.(socketId, l.ctx);
        return;
      }
      this.peers.set(socketId, { kind: 'pending-in', ctx: l.ctx });
      this.handlers.onRequest?.({ peerId: socketId, ctx: l.ctx, code: !!key && !!this.opts.isCodeKey?.(key) });
      return;
    }
    if (p.kind === 'pending-out') {
      if (l.t === 'accept') {
        this.timers.clearTimeout(p.timer);
        this.peers.set(socketId, { kind: 'up', ctx: null });
        this.handlers.onPeerUp?.(socketId, null);
      } else if (l.t === 'decline') {
        this.timers.clearTimeout(p.timer);
        this.peers.delete(socketId);
        this.native.close(socketId);
        this.handlers.onPeerDown?.(socketId, { declined: true, reason: l.reason, wasUp: false });
      }
    }
  }

  private closed(socketId: string, reason: string | null): void {
    const p = this.peers.get(socketId);
    if (!p) return;
    if (p.kind === 'pending-out') this.timers.clearTimeout(p.timer);
    this.peers.delete(socketId);
    // A guest that closed before it asked has nothing to tell.
    if (p.kind === 'pending-in' && p.ctx === null) return;
    this.handlers.onPeerDown?.(socketId, { declined: false, reason, wasUp: p.kind === 'up' });
  }
}
