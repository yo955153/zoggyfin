/**
 * A simulated player (the `PlayerPort` of src/together/player-port.ts) and a
 * simulated media reader for a guest that streams from the host.
 *
 * The player has the delays that the spike measured on real players: a play
 * starts 15–130 ms late, a seek holds the position for ~100 ms, a rate change
 * holds it for ~20 ms. A streaming player waits for data like ExoPlayer: it
 * starts with 2.5 s of media, stalls at the end of the buffer, and the reader
 * stops reading (TCP back-pressure) at MAX_BUFFER ahead and reads again under
 * RESUME_BUFFER (first report: 50 s and 30 s, the ExoPlayer defaults).
 */
import net from 'node:net';
import { performance } from 'node:perf_hooks';

import type { PlayerPort } from '../../src/together/player-port';

export interface PlayerTiming {
  startDelay(): number;
  seekDelay: number;
  rateDelay: number;
}

export const REAL_TIMING: PlayerTiming = {
  startDelay: () => 15 + Math.random() * 115,
  seekDelay: 100,
  rateDelay: 20,
};

const START_BUFFER = 2.5;
/**
 * The read-ahead of a player that streams from the host: 15 s since the fix
 * (HOST_READ_AHEAD in src/together/nearby.ts; the players' default is 50 s).
 * BENCH_READ_AHEAD sets it; it reads again under 2/3 of it.
 */
const MAX_BUFFER = Number(process.env.BENCH_READ_AHEAD ?? '15');
const RESUME_BUFFER = (MAX_BUFFER * 2) / 3;

export class SimPlayer implements PlayerPort {
  private base = 0;
  private runFrom = 0;
  private playing = false;
  private rate = 1;
  private buffering = false;
  private listeners = new Set<(b: boolean) => void>();
  private tick: NodeJS.Timeout;
  rebuffers = 0;
  stalledMs = 0;
  private stallAt = 0;

  constructor(
    private readonly now: () => number,
    private readonly timing: PlayerTiming = REAL_TIMING,
    readonly media: MediaFeed | null = null,
    start = 0,
  ) {
    this.base = start;
    this.runFrom = now();
    this.tick = setInterval(() => this.check(), 50);
  }

  dispose(): void {
    clearInterval(this.tick);
    this.media?.stop();
  }

  position(): number {
    if (!this.playing || this.buffering) return this.base;
    const t = this.now();
    return this.base + (Math.max(0, t - this.runFrom) / 1000) * this.rate;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  isBuffering(): boolean {
    return this.buffering;
  }

  private rebase(holdMs = 0): void {
    this.base = this.position();
    this.runFrom = Math.max(this.runFrom, this.now() + holdMs);
  }

  play(): void {
    if (this.playing) return;
    this.base = this.position();
    this.runFrom = this.now() + this.timing.startDelay();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.base = this.position();
    this.playing = false;
  }

  seek(seconds: number): void {
    this.base = Math.max(0, seconds);
    this.runFrom = this.now() + this.timing.seekDelay;
    this.media?.seek(this.base);
  }

  setRate(rate: number): void {
    this.rebase(this.timing.rateDelay);
    this.rate = rate;
  }

  onBuffering(listener: (b: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setBuffering(b: boolean): void {
    if (b === this.buffering) return;
    if (b) {
      this.base = this.position();
      this.rebuffers += 1;
      this.stallAt = this.now();
    } else {
      this.runFrom = this.now();
      this.stalledMs += this.now() - this.stallAt;
    }
    this.buffering = b;
    this.listeners.forEach((l) => l(b));
  }

  /** A streaming player stalls at the end of its data and goes on with 2.5 s of data. */
  private check(): void {
    const m = this.media;
    if (!m) return;
    const pos = this.position();
    m.flow(pos);
    // A paused player that seeks to a place with no data also waits for data (it is not ready).
    const ahead = m.availableSec() - pos;
    if (!this.buffering && ahead < 0.05 && !m.atEnd()) this.setBuffering(true);
    else if (this.buffering && (ahead >= START_BUFFER || m.atEnd())) this.setBuffering(false);
  }
}

/** Reads the host's file over HTTP range like a player: one open-ended range, paused by back-pressure. */
export class MediaFeed {
  private sock: net.Socket | null = null;
  private startByte = 0;
  private received = 0;
  private paused = false;
  private gen = 0;
  /** Absolute times (performance.timeOrigin based), ms. */
  firstByteAt: number | null = null;
  firstMbAt: number | null = null;
  startupAt: number | null = null;
  totalBytes = 0;
  requests = 0;
  private onStartup: (() => void) | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly path: string,
    /** Media bytes per second (the bitrate / 8). */
    readonly bytesPerSec: number,
    private readonly size: number,
    private readonly firstMb = 2 * 1024 * 1024,
  ) {}

  availableSec(): number {
    return (this.startByte + this.received) / this.bytesPerSec;
  }

  atEnd(): boolean {
    return this.startByte + this.received >= this.size;
  }

  /** Opens the stream at a position; `onStartup` fires when 2.5 s of media is there. */
  open(seconds: number, onStartup?: () => void): void {
    this.onStartup = onStartup ?? null;
    this.restart(seconds);
  }

  seek(seconds: number): void {
    const b = Math.floor(seconds * this.bytesPerSec);
    if (b >= this.startByte && b <= this.startByte + this.received + this.bytesPerSec) return;
    this.restart(seconds);
  }

  /** Back-pressure: stop reading at 50 s ahead, read again under 30 s. */
  flow(position: number): void {
    const ahead = this.availableSec() - position;
    if (!this.sock) return;
    if (!this.paused && ahead > MAX_BUFFER) {
      this.paused = true;
      this.sock.pause();
    } else if (this.paused && ahead < RESUME_BUFFER) {
      this.paused = false;
      this.sock.resume();
    }
  }

  stop(): void {
    this.gen += 1;
    this.sock?.destroy();
    this.sock = null;
  }

  private restart(seconds: number): void {
    this.stop();
    const gen = this.gen;
    this.startByte = Math.min(this.size - 1, Math.floor(seconds * this.bytesPerSec));
    this.received = 0;
    this.paused = false;
    this.requests += 1;
    const sock = net.connect({ host: this.host, port: this.port, noDelay: true });
    this.sock = sock;
    let head: Buffer | null = Buffer.alloc(0);
    sock.on('connect', () => sock.write(`GET ${this.path} HTTP/1.1\r\nHost: bench\r\nRange: bytes=${this.startByte}-\r\nConnection: keep-alive\r\n\r\n`));
    sock.on('error', () => undefined);
    sock.on('data', (d: Buffer) => {
      if (gen !== this.gen) return;
      let body = d;
      if (head) {
        head = Buffer.concat([head, d]);
        const i = head.indexOf('\r\n\r\n');
        if (i < 0) return;
        body = head.subarray(i + 4);
        head = null;
      }
      this.received += body.length;
      this.totalBytes += body.length;
      const abs = performance.timeOrigin + performance.now();
      if (this.firstByteAt === null && body.length) this.firstByteAt = abs;
      if (this.firstMbAt === null && this.totalBytes >= this.firstMb) this.firstMbAt = abs;
      if (this.onStartup && this.received >= START_BUFFER * this.bytesPerSec) {
        this.startupAt ??= abs;
        const cb = this.onStartup;
        this.onStartup = null;
        cb();
      }
    });
  }
}

/** Downloads a byte range as fast as the host sends it. Resolves with the bytes and the ms it took. */
export function download(host: string, port: number, path: string, bytes: number): Promise<{ bytes: number; ms: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sock = net.connect({ host, port, noDelay: true });
    let got = 0;
    let head: Buffer | null = Buffer.alloc(0);
    sock.on('connect', () => sock.write(`GET ${path} HTTP/1.1\r\nHost: bench\r\nRange: bytes=0-${bytes - 1}\r\n\r\n`));
    sock.on('error', () => resolve({ bytes: got, ms: performance.now() - t0 }));
    sock.on('data', (d: Buffer) => {
      let body = d;
      if (head) {
        head = Buffer.concat([head, d]);
        const i = head.indexOf('\r\n\r\n');
        if (i < 0) return;
        body = head.subarray(i + 4);
        head = null;
      }
      got += body.length;
      if (got >= bytes) {
        sock.destroy();
        resolve({ bytes: got, ms: performance.now() - t0 });
      }
    });
  });
}
