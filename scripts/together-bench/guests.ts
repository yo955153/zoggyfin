/**
 * A guest process of the benchmark: some guests, each with its own clock
 * (a random skew), the real NearbyLink (link.ts) and the real Follower
 * (follower.ts), and a simulated player. A guest with "stream" reads the
 * host's file over HTTP range (MediaFeed); a guest with "local" plays its own copy.
 */
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { positionAt } from '../../src/together/drift';
import { Follower } from '../../src/together/follower';
import { NearbyLink } from '../../src/together/link';
import { realTimers } from '../../src/together/player-port';
import type { Anchor, Message } from '../../src/together/protocol';
import { NodeLinkNative } from './node-link';
import { download, MediaFeed, SimPlayer } from './sim-player';

const abs = () => performance.timeOrigin + performance.now();

interface Opts {
  port: number;
  path: string;
  hostOrigin: number;
  mode: 'local' | 'stream';
  bitrateMbps: number;
  file: string;
}

class BenchGuest {
  readonly skew = (Math.random() - 0.5) * 2e6;
  readonly native = new NodeLinkNative(this.skew);
  private link = new NearbyLink(this.native, realTimers, { joinTimeout: 120_000 });
  private follower: Follower | null = null;
  player: SimPlayer | null = null;
  private media: MediaFeed | null = null;
  private peer: string | null = null;
  t: { connect: number; accept?: number; welcome?: number; firstMb?: number; startup?: number; attached?: number } = { connect: 0 };
  samples: { err: number; drift: number | null; clockErr: number; rtt: number }[] = [];
  private sampler: NodeJS.Timeout | null = null;
  private lastJumpAt = -Infinity;
  private lastAnchor: Anchor | null = null;

  constructor(
    readonly name: string,
    private readonly o: Opts,
  ) {}

  private now = () => this.native.monotonicNow();
  /** The host clock now, from the shared absolute clock (the truth the guest must estimate). */
  private trueHostNow = () => abs() - this.o.hostOrigin;
  private trueOffset = () => this.trueHostNow() - this.now();

  join(): void {
    this.t.connect = abs();
    this.link.open();
    this.link.setHandlers({
      onPeerUp: (peer) => {
        this.t.accept = abs();
        this.startFollower(peer);
      },
      onMessage: (_peer, m, at) => this.onMessage(m, at),
    });
    const local = this.o.mode === 'local';
    this.peer = this.link.join({ host: '127.0.0.1', port: this.o.port }, { v: 1, name: this.name, have: local, memberId: this.name });
  }

  private startFollower(peer: string): void {
    this.peer = peer;
    const f = new Follower({ send: (m) => this.link.send(m, [peer]), now: this.now, timers: realTimers });
    this.follower = f;
    f.start(this.name, this.o.mode === 'local' ? ['item-1'] : [], { memberId: this.name, canHost: this.o.mode === 'local' });
  }

  private onMessage(m: Message, at: number): void {
    const f = this.follower;
    if (!f) return;
    f.receive(m, at);
    const a = f.groupAnchor;
    if (a && (!this.lastAnchor || a.playing !== this.lastAnchor.playing || a.rate !== this.lastAnchor.rate || Math.abs(positionAt(this.lastAnchor, a.hostTime) - a.position) > 0.5)) this.lastJumpAt = this.now();
    this.lastAnchor = a;
    if (m.t === 'welcome') {
      this.t.welcome = abs();
      this.load(f);
    }
  }

  private startPos(f: Follower): number {
    const a = f.groupAnchor;
    const h = f.hostNow();
    return a ? (h !== null ? positionAt(a, h) : a.position) : 0;
  }

  private load(f: Follower): void {
    if (this.o.mode === 'local') {
      // Opening a local file: about 300 ms on a phone.
      setTimeout(() => this.attach(f, new SimPlayer(this.now, undefined, null, this.startPos(f)), true), 300);
      return;
    }
    const size = fs.statSync(this.o.file).size;
    const feed = new MediaFeed('127.0.0.1', this.o.port, this.o.path, (this.o.bitrateMbps * 1e6) / 8, size);
    this.media = feed;
    const start = this.startPos(f);
    feed.open(start, () => {
      this.t.startup = abs();
      this.attach(f, new SimPlayer(this.now, undefined, feed, start), false);
    });
  }

  private attach(f: Follower, p: SimPlayer, local: boolean): void {
    this.player = p;
    this.t.attached = abs();
    f.attach(p, local);
    this.sampler = setInterval(() => this.sample(), 250);
  }

  /** The true error: the group's expected position (on the true host clock) minus the player position. */
  private sample(): void {
    const f = this.follower;
    const p = this.player;
    const a = f?.groupAnchor;
    const e = f?.stats.clock;
    if (!f || !p || !a || !e) return;
    const hostNow = this.trueHostNow();
    // Leave out the 3 s after each jump (start, pause, seek, rate): the follower is still on its way.
    if (!a.playing || hostNow < a.hostTime || this.now() - this.lastJumpAt < 3000 || p.isBuffering()) return;
    this.samples.push({ err: positionAt(a, hostNow) - p.position(), drift: f.stats.drift, clockErr: e.offset - this.trueOffset(), rtt: e.rtt });
  }

  report() {
    if (this.media) {
      this.t.firstMb = this.media.firstMbAt ?? undefined;
    }
    return {
      name: this.name,
      t: this.t,
      samples: this.samples,
      rebuffers: this.player?.rebuffers ?? 0,
      stalledMs: this.player?.stalledMs ?? 0,
      mediaBytes: this.media?.totalBytes ?? 0,
      mediaRequests: this.media?.requests ?? 0,
      corrections: this.follower?.stats.corrections ?? null,
      bytesUp: this.native.counters.bytesOut,
      bytesDown: this.native.counters.bytesIn,
    };
  }

  resetStats(): void {
    this.samples = [];
    this.native.counters.reset();
    if (this.player) {
      this.player.rebuffers = 0;
      this.player.stalledMs = 0;
    }
    if (this.media) this.media.totalBytes = 0;
  }

  stop(): void {
    if (this.sampler) clearInterval(this.sampler);
    this.follower?.leave();
    this.player?.dispose();
    this.media?.stop();
    this.link.close();
  }
}

let guests: BenchGuest[] = [];

process.on('message', async (msg: { cmd: string; id: number; opts?: Opts; names?: string[]; bytes?: number }) => {
  const reply = (body: object) => process.send!({ type: 'reply', id: msg.id, ...body });
  switch (msg.cmd) {
    case 'join':
      guests = msg.names!.map((n) => new BenchGuest(n, msg.opts!));
      guests.forEach((g) => g.join());
      reply({});
      return;
    case 'reset':
      guests.forEach((g) => g.resetStats());
      reply({});
      return;
    case 'report':
      reply({ guests: guests.map((g) => g.report()) });
      return;
    case 'download': {
      // Max throughput: every guest downloads `bytes` at once, as fast as it can.
      const o = msg.opts!;
      const results = await Promise.all(msg.names!.map(() => download('127.0.0.1', o.port, o.path, msg.bytes!)));
      reply({ results });
      return;
    }
    case 'stop':
      guests.forEach((g) => g.stop());
      reply({});
      setTimeout(() => process.exit(0), 100);
      return;
  }
});

process.send!({ type: 'ready' });
