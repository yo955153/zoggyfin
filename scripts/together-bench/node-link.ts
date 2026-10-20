/**
 * A Node.js version of the nearby transport (`src/together/link-native-types.ts`),
 * for the benchmark only. It follows the wire format of the native code:
 *
 * - one TCP port per session;
 * - a control socket starts with "ZGF1", then 4-byte big-endian length frames of UTF-8 JSON;
 * - any other connection is HTTP/1.1 GET/HEAD with one Range, served in 256 KB
 *   chunks; the next chunk is read only when the last one left (as
 *   MediaServer.swift does with `.contentProcessed`).
 *
 * It also counts every frame and every media byte, and it can shape the
 * host's upload (a model of a Wi-Fi radio: one FIFO queue at a fixed bit rate).
 */
import fs from 'node:fs';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

import type { LinkEvents, MediaStats, NearbyLinkNative } from '../../src/together/link-native-types';

const PREFACE = Buffer.from('ZGF1');
const MAX_FRAME = 1_048_576;
const CHUNK = 256 * 1024;

export interface TypeCount {
  out: number;
  outBytes: number;
  in: number;
  inBytes: number;
}

export class Counters {
  framesOut = 0;
  bytesOut = 0;
  framesIn = 0;
  bytesIn = 0;
  byType: Record<string, TypeCount> = {};
  httpBytes = 0;
  httpRequests = 0;
  httpOpen = 0;
  httpPeak = 0;

  reset(): void {
    this.framesOut = this.bytesOut = this.framesIn = this.bytesIn = 0;
    this.byType = {};
    this.httpBytes = this.httpRequests = 0;
    this.httpPeak = this.httpOpen;
  }

  type(text: string): TypeCount {
    const m = /"t":"(\w+)"/.exec(text) ?? /"l":"(\w+)"/.exec(text);
    const k = m ? m[1] : '?';
    return (this.byType[k] ??= { out: 0, outBytes: 0, in: 0, inBytes: 0 });
  }
}

/** One FIFO queue that sends at a fixed bit rate: a model of a radio's upload. */
export class Shaper {
  private queue: { sock: net.Socket; buf: Buffer; cb?: () => void }[] = [];
  private nextFree = 0;
  private timer: NodeJS.Timeout | null = null;
  /** The largest queue delay seen, ms. */
  maxDelay = 0;
  private enq = new WeakMap<Buffer, number>();

  constructor(private readonly bitsPerSecond: number) {}

  send(sock: net.Socket, buf: Buffer, cb?: () => void): void {
    this.enq.set(buf, performance.now());
    this.queue.push({ sock, buf, cb });
    this.pump();
  }

  private pump(): void {
    if (this.timer) return;
    const now = performance.now();
    while (this.queue.length && now >= this.nextFree) {
      const item = this.queue.shift()!;
      const d = now - (this.enq.get(item.buf) ?? now);
      if (d > this.maxDelay) this.maxDelay = d;
      if (!item.sock.destroyed) item.sock.write(item.buf);
      this.nextFree = Math.max(this.nextFree, now) + ((item.buf.length * 8) / this.bitsPerSecond) * 1000;
      item.cb?.();
    }
    if (this.queue.length) {
      this.timer = setTimeout(
        () => {
          this.timer = null;
          this.pump();
        },
        Math.max(0, this.nextFree - now),
      );
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }
}

type Listener = (e: unknown) => void;

interface FrameSock {
  id: string;
  sock: net.Socket;
  buf: Buffer;
  open: boolean;
}

export class NodeLinkNative implements NearbyLinkNative {
  readonly platform = 'apple' as const;
  readonly counters = new Counters();
  private listeners = new Map<string, Set<Listener>>();
  private server: net.Server | null = null;
  private sockets = new Map<string, FrameSock>();
  private http = new Set<net.Socket>();
  private files = new Map<string, { path: string; mime: string }>();
  private n = 0;

  /**
   * @param skew ms added to this device's monotonic clock (each device has its own clock).
   * @param shaper the host's upload model, or null (loopback speed).
   */
  constructor(
    private readonly skew = 0,
    private readonly shaper: Shaper | null = null,
  ) {}

  monotonicNow(): number {
    return performance.now() + this.skew;
  }

  randomBytes(n: number): string {
    return Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256))).toString('base64');
  }

  on<K extends keyof LinkEvents>(name: K, listener: LinkEvents[K]): { remove(): void } {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener as Listener);
    return { remove: () => set!.delete(listener as Listener) };
  }

  private emit(name: keyof LinkEvents, e: unknown): void {
    this.listeners.get(name)?.forEach((l) => l(e));
  }

  // ---- Host ----

  startServer(_serviceName: string, _txt: Record<string, string>): Promise<{ port: number; service: string }> {
    return new Promise((resolve, reject) => {
      const s = net.createServer({ noDelay: true }, (sock) => this.accept(sock));
      s.maxConnections = 10_000;
      s.on('error', reject);
      s.listen(0, '127.0.0.1', () => {
        this.server = s;
        resolve({ port: (s.address() as net.AddressInfo).port, service: 'zgf-bench' });
      });
    });
  }

  stopAdvertising(): void {}

  shareFile(urlPath: string, filePath: string, mimeType: string): void {
    this.files.set(urlPath, { path: filePath, mime: mimeType });
  }

  unshareAll(): void {
    this.files.clear();
  }

  stopServer(): void {
    this.server?.close();
    this.server = null;
    for (const h of this.http) h.destroy();
    for (const s of this.sockets.values()) s.sock.destroy();
    this.shaper?.stop();
  }

  private accept(sock: net.Socket): void {
    let head = Buffer.alloc(0);
    const first = (d: Buffer) => {
      head = Buffer.concat([head, d]);
      if (head.length < 4) return;
      sock.off('data', first);
      if (head.subarray(0, 4).equals(PREFACE)) {
        const id = `s${++this.n}`;
        const fs_: FrameSock = { id, sock, buf: Buffer.alloc(0), open: true };
        this.sockets.set(id, fs_);
        this.emit('onSocketOpen', { socketId: id, inbound: true });
        this.readFrames(fs_, head.subarray(4));
      } else {
        this.serveHttp(sock, head);
      }
    };
    sock.on('data', first);
    sock.on('error', () => undefined);
  }

  private serveHttp(sock: net.Socket, initial: Buffer): void {
    const c = this.counters;
    this.http.add(sock);
    c.httpOpen += 1;
    if (c.httpOpen > c.httpPeak) c.httpPeak = c.httpOpen;
    let buf = initial;
    let busy = false;
    let fd: number | null = null;
    const done = () => {
      if (!this.http.delete(sock)) return;
      c.httpOpen -= 1;
      if (fd !== null) fs.close(fd, () => undefined);
      fd = null;
    };
    sock.on('close', done);
    const write = (b: Buffer, cb: () => void) => {
      if (this.shaper) this.shaper.send(sock, b, () => (sock.writableNeedDrain ? sock.once('drain', cb) : cb()));
      else if (sock.write(b)) cb();
      else sock.once('drain', cb);
    };
    const next = () => {
      if (busy || sock.destroyed) return;
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.subarray(0, end).toString('utf8');
      buf = buf.subarray(end + 4);
      busy = true;
      c.httpRequests += 1;
      const lines = head.split('\r\n');
      const [method, rawPath] = lines[0].split(' ');
      const path = (rawPath ?? '').split('?')[0];
      const headers: Record<string, string> = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(':');
        if (i > 0) headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim();
      }
      const file = this.files.get(path);
      const finish = () => {
        busy = false;
        next();
      };
      const respond = (status: string, extra = '') => write(Buffer.from(`HTTP/1.1 ${status}\r\n${extra}Content-Length: 0\r\nConnection: keep-alive\r\n\r\n`), finish);
      if (method !== 'GET' && method !== 'HEAD') return respond('405 Method Not Allowed');
      if (!file) return respond('404 Not Found');
      const size = fs.statSync(file.path).size;
      let start = 0;
      let last = size - 1;
      const r = headers.range;
      if (r) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(r);
        if (!m || (m[1] === '' && m[2] === '')) return respond('416 Range Not Satisfiable', `Content-Range: bytes */${size}\r\n`);
        if (m[1] === '') {
          start = Math.max(0, size - Number(m[2]));
        } else {
          start = Number(m[1]);
          last = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
        }
        if (start >= size || last < start) return respond('416 Range Not Satisfiable', `Content-Range: bytes */${size}\r\n`);
      }
      const length = last - start + 1;
      const status = r ? '206 Partial Content' : '200 OK';
      const range = r ? `Content-Range: bytes ${start}-${last}/${size}\r\n` : '';
      write(Buffer.from(`HTTP/1.1 ${status}\r\nContent-Type: ${file.mime}\r\nContent-Length: ${length}\r\nAccept-Ranges: bytes\r\n${range}Connection: keep-alive\r\n\r\n`), () => {
        if (method === 'HEAD') return finish();
        fd ??= fs.openSync(file.path, 'r');
        let pos = start;
        let remaining = length;
        const pump = () => {
          if (sock.destroyed || fd === null) return;
          if (remaining <= 0) return finish();
          const n = Math.min(CHUNK, remaining);
          const chunk = Buffer.allocUnsafe(n);
          fs.read(fd, chunk, 0, n, pos, (err, got) => {
            if (err || got <= 0) return sock.destroy();
            pos += got;
            remaining -= got;
            c.httpBytes += got;
            write(got === n ? chunk : chunk.subarray(0, got), pump);
          });
        };
        pump();
      });
    };
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      next();
    });
    next();
  }

  // ---- Guest ----

  startBrowsing(): void {}
  stopBrowsing(): void {}

  connect(_serviceId: string): string {
    throw new Error('The benchmark joins with an address.');
  }

  connectAddress(host: string, port: number): string {
    const id = `c${++this.n}`;
    const sock = net.connect({ host, port, noDelay: true });
    const f: FrameSock = { id, sock, buf: Buffer.alloc(0), open: false };
    this.sockets.set(id, f);
    sock.on('connect', () => {
      sock.write(PREFACE);
      f.open = true;
      this.emit('onSocketOpen', { socketId: id, inbound: false });
    });
    sock.on('error', () => undefined);
    this.readFrames(f, Buffer.alloc(0));
    return id;
  }

  mediaBase(_serviceId: string | null, host: string | null, port: number): Promise<string> {
    return Promise.resolve(`http://${host}:${port}`);
  }

  stopRelay(): void {}

  // ---- Both ----

  private readFrames(f: FrameSock, initial: Buffer): void {
    const c = this.counters;
    const parse = () => {
      const at = this.monotonicNow();
      while (f.buf.length >= 4) {
        const n = f.buf.readUInt32BE(0);
        if (n < 1 || n > MAX_FRAME) {
          f.sock.destroy();
          return;
        }
        if (f.buf.length < 4 + n) break;
        const text = f.buf.subarray(4, 4 + n).toString('utf8');
        f.buf = f.buf.subarray(4 + n);
        c.framesIn += 1;
        c.bytesIn += 4 + n;
        const t = c.type(text);
        t.in += 1;
        t.inBytes += 4 + n;
        this.emit('onFrame', { socketId: f.id, text, receivedAt: at });
      }
    };
    f.buf = initial;
    if (f.buf.length) parse();
    f.sock.on('data', (d: Buffer) => {
      f.buf = f.buf.length ? Buffer.concat([f.buf, d]) : d;
      parse();
    });
    f.sock.on('close', () => {
      if (!this.sockets.delete(f.id)) return;
      f.open = false;
      this.emit('onSocketClosed', { socketId: f.id, reason: 'closed' });
    });
  }

  send(socketId: string, text: string): boolean {
    const f = this.sockets.get(socketId);
    if (!f || !f.open) return false;
    const body = Buffer.from(text, 'utf8');
    const frame = Buffer.allocUnsafe(4 + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);
    const c = this.counters;
    c.framesOut += 1;
    c.bytesOut += frame.length;
    const t = c.type(text);
    t.out += 1;
    t.outBytes += frame.length;
    if (this.shaper) this.shaper.send(f.sock, frame);
    else f.sock.write(frame);
    return true;
  }

  close(socketId: string): void {
    this.sockets.get(socketId)?.sock.destroy();
  }

  addresses() {
    return Promise.resolve([{ name: 'lo0', address: '127.0.0.1', kind: 'other' as const }]);
  }

  stopAll(): void {
    this.stopServer();
  }

  mediaStats(): MediaStats {
    return { served: this.counters.httpBytes, requests: this.counters.httpRequests, relayed: 0 };
  }
}
