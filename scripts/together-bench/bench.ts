/**
 * Nearby "Watch together" benchmark: one host and N guests on loopback, with
 * the real protocol code of src/together (link.ts, room.ts, follower.ts,
 * clock.ts, drift.ts) on a Node version of the transport (node-link.ts).
 *
 * Usage: pnpm bench:together [--quick] [--n 1,4,8,16,32] [--steady 20]
 *   (or: bash scripts/together-bench/run.sh ...)
 *
 * Each run: N guests join at once (a join storm), the group plays, then a
 * steady window, then pause / seek / play / rate commands. The results go to
 * stdout (Markdown tables) and to BENCH_OUT (JSON).
 */
import { type ChildProcess, fork, spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { encode, decode, type Member, type Message } from '../../src/together/protocol';

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const QUICK = args.includes('--quick');
const NS = arg('n', QUICK ? '1,4,16' : '1,4,8,16,32').split(',').map(Number);
const STEADY = Number(arg('steady', QUICK ? '8' : '30')) * 1000;
const SWIFT_HOST = process.env.BENCH_SWIFT_HOST ?? '';
const BITRATE = Number(arg('bitrate', '8'));
const FILE = process.env.BENCH_FILE ?? '';
const OUT = process.env.BENCH_OUT ?? path.join(here, 'results.json');
const GUESTS_PER_PROC = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!FILE || !fs.existsSync(FILE)) {
  console.error('Set BENCH_FILE to a media file (run.sh makes one).');
  process.exit(1);
}

// ---- IPC ----

class Proc {
  private n = 0;
  private waiters = new Map<number, (v: any) => void>();
  readyMsg: Promise<any>;
  constructor(readonly child: ChildProcess) {
    let ready!: (v: any) => void;
    this.readyMsg = new Promise((r) => (ready = r));
    child.on('message', (m: any) => {
      if (m.type === 'ready') ready(m);
      else if (m.type === 'reply') {
        this.waiters.get(m.id)?.(m);
        this.waiters.delete(m.id);
      }
    });
  }
  call(cmd: string, body: object = {}): Promise<any> {
    const id = ++this.n;
    return new Promise((r) => {
      this.waiters.set(id, r);
      this.child.send({ cmd, id, ...body });
    });
  }
  kill(): void {
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
  }
}

function spawn(script: string, env: Record<string, string> = {}): Proc {
  const child = fork(path.join(here, script), [], { execArgv: process.execArgv, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  return new Proc(child);
}

// ---- Stats helpers ----

function pct(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : NaN);
const r0 = (x: number) => (Number.isFinite(x) ? Math.round(x) : NaN);

interface RunOpts {
  n: number;
  mode: 'local' | 'stream';
  uplinkMbps?: number;
  /** Skip the command phase (the join storm test). */
  joinOnly?: boolean;
}

async function waitReady(host: Proc, n: number, timeout: number): Promise<{ ms: number; ok: boolean }> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const { stats } = await host.call('stats');
    if (stats.members >= n && stats.ready >= n && !stats.waiting) return { ms: performance.now() - t0, ok: true };
    await sleep(50);
  }
  return { ms: timeout, ok: false };
}

async function guestReports(procs: Proc[]): Promise<any[]> {
  const rs = await Promise.all(procs.map((p) => p.call('report')));
  return rs.flatMap((r) => r.guests);
}

function syncSummary(guests: any[]) {
  const errs = guests.flatMap((g) => g.samples.map((s: any) => Math.abs(s.err) * 1000));
  const clock = guests.flatMap((g) => g.samples.map((s: any) => Math.abs(s.clockErr)));
  const rtt = guests.flatMap((g) => g.samples.map((s: any) => s.rtt));
  return { errP50: r1(pct(errs, 50)), errP95: r1(pct(errs, 95)), errMax: r1(Math.max(...errs)), clockP95: r1(pct(clock, 95)), rttP50: r1(pct(rtt, 50)), samples: errs.length };
}

function ctrlRates(s: any) {
  return {
    outBps: r0(s.bytesOut / s.secs),
    inBps: r0(s.bytesIn / s.secs),
    outMsgs: r1(s.framesOut / s.secs),
    inMsgs: r1(s.framesIn / s.secs),
    byType: Object.fromEntries(Object.entries(s.byType).map(([k, v]: [string, any]) => [k, { outPerSec: r1(v.out / s.secs), outBps: r0(v.outBytes / s.secs), inPerSec: r1(v.in / s.secs), inBps: r0(v.inBytes / s.secs), avgOut: v.out ? r0(v.outBytes / v.out) : 0 }])),
  };
}

async function run(o: RunOpts) {
  const label = `${o.mode} N=${o.n}${o.uplinkMbps ? ` uplink=${o.uplinkMbps}Mbit/s` : ''}${o.joinOnly ? ' (join storm)' : ''}`;
  process.stderr.write(`\n== ${label}\n`);
  const host = spawn('host.ts', { BENCH_FILE: FILE, BENCH_UPLINK_MBPS: String(o.uplinkMbps ?? 0) });
  const procs: Proc[] = [];
  try {
    const { port, path: mediaPath, origin } = await host.readyMsg;
    const nProcs = Math.ceil(o.n / GUESTS_PER_PROC);
    for (let i = 0; i < nProcs; i++) procs.push(spawn('guests.ts'));
    await Promise.all(procs.map((p) => p.readyMsg));
    const opts = { port, path: mediaPath, hostOrigin: origin, mode: o.mode, bitrateMbps: BITRATE, file: FILE };

    // 1. The join storm: every guest connects at the same moment.
    await host.call('reset');
    await Promise.all(procs.map((p, i) => p.call('join', { opts, names: Array.from({ length: Math.min(GUESTS_PER_PROC, o.n - i * GUESTS_PER_PROC) }, (_, k) => `g${i * GUESTS_PER_PROC + k}`) })));
    const ready = await waitReady(host, o.n, 120_000);
    const joinStats = (await host.call('stats')).stats;
    let gs = await guestReports(procs);
    const welcome = gs.map((g) => g.t.welcome - g.t.connect).filter(Number.isFinite);
    const ttfMb = gs.map((g) => g.t.firstMb - g.t.welcome).filter(Number.isFinite);
    const startup = gs.map((g) => g.t.startup - g.t.welcome).filter(Number.isFinite);
    const join = {
      allReadyMs: r0(ready.ms),
      ok: ready.ok,
      welcomeP50: r1(pct(welcome, 50)),
      welcomeP95: r1(pct(welcome, 95)),
      welcomeMax: r1(Math.max(...welcome)),
      ctrlBytesOut: joinStats.bytesOut,
      ctrlFramesOut: joinStats.framesOut,
      membersBytesOut: joinStats.byType.members?.outBytes ?? 0,
      stateBytesOut: joinStats.byType.state?.outBytes ?? 0,
      firstMbP50: r0(pct(ttfMb, 50)),
      firstMbMax: r0(Math.max(...ttfMb)),
      startupP50: r0(pct(startup, 50)),
      startupMax: r0(Math.max(...startup)),
    };
    if (o.joinOnly) return { label, ...o, join };

    // 2. Play, then a steady window.
    await host.call('control', { action: { action: 'play' } });
    await sleep(4000);
    await host.call('reset');
    await Promise.all(procs.map((p) => p.call('reset')));
    await sleep(STEADY);
    const st = (await host.call('stats')).stats;
    gs = await guestReports(procs);
    const steady = {
      ctrl: ctrlRates(st),
      mediaMbps: r1((st.httpBytes * 8) / st.secs / 1e6),
      httpRequests: st.httpRequests,
      httpPeak: st.httpPeak,
      cpuPct: r1(st.cpuPct),
      elu: r1(st.elu * 100),
      loopP99: r1(st.loopP99),
      rssMb: r0(st.rssMb),
      shaperMaxDelay: r0(st.shaperMaxDelay),
      hostDriftMs: st.hostDrift === null ? null : r1(st.hostDrift * 1000),
      sync: syncSummary(gs),
      rebuffers: gs.reduce((a, g) => a + g.rebuffers, 0),
      stalledMs: r0(gs.reduce((a, g) => a + g.stalledMs, 0)),
      guestUpBps: r0(gs.reduce((a, g) => a + g.bytesUp, 0) / o.n / st.secs),
      guestDownBps: r0(gs.reduce((a, g) => a + g.bytesDown, 0) / o.n / st.secs),
    };

    // 3. Commands: pause, seek, play, rate 1.5, rate 1.
    await host.call('reset');
    await Promise.all(procs.map((p) => p.call('reset')));
    await host.call('control', { action: { action: 'pause' } });
    await sleep(2000);
    await host.call('control', { action: { action: 'seek', position: 100 } });
    await sleep(1000);
    const tPlay = performance.now();
    await host.call('control', { action: { action: 'play' } });
    await sleep(50);
    const seekReady = await waitReady(host, o.n, 60_000);
    const seekToPlayMs = performance.now() - tPlay;
    await sleep(5000);
    await host.call('control', { action: { action: 'rate', rate: 1.5 } });
    await sleep(6000);
    await host.call('control', { action: { action: 'rate', rate: 1 } });
    await sleep(6000);
    const ct = (await host.call('stats')).stats;
    gs = await guestReports(procs);
    const commands = {
      ctrl: ctrlRates(ct),
      seekToPlayMs: r0(seekToPlayMs),
      seekOk: seekReady.ok,
      sync: syncSummary(gs),
      rebuffers: gs.reduce((a, g) => a + g.rebuffers, 0),
      corrections: gs.reduce((a, g) => ({ rate: a.rate + (g.corrections?.rate ?? 0), seek: a.seek + (g.corrections?.seek ?? 0) }), { rate: 0, seek: 0 }),
      mediaRequests: gs.reduce((a, g) => a + g.mediaRequests, 0),
    };
    return { label, ...o, join, steady, commands };
  } finally {
    await Promise.race([Promise.all(procs.map((p) => p.call('stop'))), sleep(2000)]);
    await Promise.race([host.call('stop'), sleep(1000)]);
    await sleep(300);
    procs.forEach((p) => p.kill());
    host.kill();
  }
}

/** Max media throughput of the host: N guests each download `mb` MB at once. */
async function throughput(n: number, mb: number) {
  process.stderr.write(`\n== throughput N=${n}\n`);
  const host = spawn('host.ts', { BENCH_FILE: FILE });
  const procs: Proc[] = [];
  try {
    const { port, path: mediaPath, origin } = await host.readyMsg;
    for (let i = 0; i < Math.ceil(n / GUESTS_PER_PROC); i++) procs.push(spawn('guests.ts'));
    await Promise.all(procs.map((p) => p.readyMsg));
    const opts = { port, path: mediaPath, hostOrigin: origin, mode: 'stream', bitrateMbps: BITRATE, file: FILE };
    await host.call('reset');
    const t0 = performance.now();
    const rs = await Promise.all(procs.map((p, i) => p.call('download', { opts, names: Array.from({ length: Math.min(GUESTS_PER_PROC, n - i * GUESTS_PER_PROC) }, (_, k) => `g${k}`), bytes: mb * 1048576 })));
    const ms = performance.now() - t0;
    const st = (await host.call('stats')).stats;
    const per = rs.flatMap((r) => r.results.map((x: any) => (x.bytes * 8) / (x.ms / 1000) / 1e6));
    return { n, mb, totalMbps: r0((st.httpBytes * 8) / (ms / 1000) / 1e6), perGuestMinMbps: r0(Math.min(...per)), perGuestMaxMbps: r0(Math.max(...per)), cpuPct: r1(st.cpuPct), rssMb: r0(st.rssMb), seconds: r1(ms / 1000) };
  } finally {
    procs.forEach((p) => p.kill());
    host.kill();
  }
}

/** The same throughput test against the app's own Swift media server (swift-host/main.swift). */
async function swiftThroughput(bin: string, n: number, mb: number) {
  process.stderr.write(`\n== swift throughput N=${n}\n`);
  const mediaPath = '/0123456789abcdef01234567/1.mp4';
  const child = spawnChild(bin, [FILE, mediaPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: string[] = [];
  const waiters: ((l: string) => void)[] = [];
  let partial = '';
  child.stdout!.on('data', (d: Buffer) => {
    partial += d.toString();
    let i;
    while ((i = partial.indexOf('\n')) >= 0) {
      const l = partial.slice(0, i);
      partial = partial.slice(i + 1);
      const w = waiters.shift();
      if (w) w(l);
      else lines.push(l);
    }
  });
  const line = () => new Promise<string>((r) => (lines.length ? r(lines.shift()!) : waiters.push(r)));
  const procs: Proc[] = [];
  try {
    const { port } = JSON.parse(await line());
    for (let i = 0; i < Math.ceil(n / GUESTS_PER_PROC); i++) procs.push(spawn('guests.ts'));
    await Promise.all(procs.map((p) => p.readyMsg));
    child.stdin!.write('stats\n');
    const before = JSON.parse(await line());
    const opts = { port, path: mediaPath, hostOrigin: 0, mode: 'stream', bitrateMbps: BITRATE, file: FILE };
    const t0 = performance.now();
    const rs = await Promise.all(procs.map((p, i) => p.call('download', { opts, names: Array.from({ length: Math.min(GUESTS_PER_PROC, n - i * GUESTS_PER_PROC) }, (_, k) => `g${k}`), bytes: mb * 1048576 })));
    const ms = performance.now() - t0;
    child.stdin!.write('stats\n');
    const after = JSON.parse(await line());
    const per = rs.flatMap((r) => r.results.map((x: any) => (x.bytes * 8) / (x.ms / 1000) / 1e6));
    return {
      n,
      mb,
      totalMbps: r0(((after.served - before.served) * 8) / (ms / 1000) / 1e6),
      perGuestMinMbps: r0(Math.min(...per)),
      perGuestMaxMbps: r0(Math.max(...per)),
      cpuPct: r1(((after.cpuSeconds - before.cpuSeconds) / (ms / 1000)) * 100),
      rssMb: r0(after.maxRssMb),
      seconds: r1(ms / 1000),
    };
  } finally {
    procs.forEach((p) => p.kill());
    child.stdin!.end('quit\n');
    await sleep(300);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

/** JSON encode + decode cost of each message, by group size. */
function micro() {
  const out: Record<string, unknown>[] = [];
  const member = (i: number): Member => ({ id: `member-${i}-0123456789abcdef`, name: `Guest ${i} · iPhone 15`, local: i % 2 === 0, buffering: false, joinedAt: 123456789.123 + i, canHost: true, away: false, maker: false });
  for (const n of [1, 4, 8, 16, 32]) {
    const msgs: Record<string, Message> = {
      ping: { t: 'ping', id: 12345, t0: 987654321.123456 },
      pong: { t: 'pong', id: 12345, t0: 987654321.123456, t1: 123456789.654321, t2: 123456789.712345 },
      state: { t: 'state', seq: 4567, anchor: { playing: true, rate: 1, hostTime: 123456789.123456, position: 1234.567891 }, waiting: false },
      members: { t: 'members', members: Array.from({ length: n }, (_, i) => member(i)), onlyHostControls: false },
    };
    for (const [k, m] of Object.entries(msgs)) {
      if (k !== 'members' && n !== 1) continue;
      const text = encode(m);
      const iters = 20000;
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) decode(encode(m));
      const us = ((performance.now() - t0) / iters) * 1000;
      out.push({ message: k, n: k === 'members' ? n : '-', bytes: Buffer.byteLength(text) + 4, encodeDecodeUs: r1(us) });
    }
  }
  return out;
}

// ---- Main ----

async function main(): Promise<void> {
  const results: Record<string, unknown> = { date: new Date().toISOString(), bitrateMbps: BITRATE, steadyMs: STEADY, node: process.version, runs: [], storm: null, throughput: [], shaped: [], micro: micro() };
  const runs = results.runs as unknown[];
  for (const mode of ['local', 'stream'] as const) {
    for (const n of NS) runs.push(await run({ n, mode }));
  }
  results.storm = await run({ n: 30, mode: 'local', joinOnly: true });
  for (const n of QUICK ? [16] : [1, 4, 8, 16, 32]) (results.throughput as unknown[]).push(await throughput(n, 32));
  results.swiftThroughput = [];
  if (SWIFT_HOST) for (const n of QUICK ? [16] : [1, 4, 8, 16, 32]) (results.swiftThroughput as unknown[]).push(await swiftThroughput(SWIFT_HOST, n, 32));
  // A Wi-Fi model: the host's upload is one queue at a fixed rate.
  const shaped = results.shaped as unknown[];
  for (const uplink of QUICK ? [100] : [200, 100, 40]) {
    for (const n of QUICK ? [8] : [4, 8, 16]) shaped.push(await run({ n, mode: 'stream', uplinkMbps: uplink }));
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  printTables(results);
}

function printTables(res: any): void {
  const row = (cells: unknown[]) => console.log(`| ${cells.join(' | ')} |`);
  console.log(`\n### Control and sync per N (bitrate ${res.bitrateMbps} Mbit/s, steady ${res.steadyMs / 1000} s)\n`);
  row(['mode', 'N', 'ctrl out B/s', 'ctrl in B/s', 'msgs out/s', 'msgs in/s', 'host CPU %', 'ELU %', 'RSS MB', 'media out Mbit/s', 'sync p50 ms', 'sync p95 ms', 'sync max ms', 'clock p95 ms', 'rebuffers']);
  row(Array(15).fill('---'));
  for (const r of res.runs) {
    const s = r.steady;
    row([r.mode, r.n, s.ctrl.outBps, s.ctrl.inBps, s.ctrl.outMsgs, s.ctrl.inMsgs, s.cpuPct, s.elu, s.rssMb, s.mediaMbps, s.sync.errP50, s.sync.errP95, s.sync.errMax, s.sync.clockP95, s.rebuffers]);
  }
  console.log('\n### Join storm and media start\n');
  row(['mode', 'N', 'all ready ms', 'welcome p50 ms', 'welcome max ms', 'join ctrl bytes out', 'of it members', 'first 2 MB p50 ms', 'startup p50 ms', 'startup max ms', 'seek→play ms']);
  row(Array(11).fill('---'));
  for (const r of [...res.runs, res.storm]) {
    const j = r.join;
    row([r.mode, r.n, j.allReadyMs, j.welcomeP50, j.welcomeMax, j.ctrlBytesOut, j.membersBytesOut, j.firstMbP50, j.startupP50, j.startupMax, r.commands?.seekToPlayMs ?? '-']);
  }
  console.log('\n### Commands phase (pause, seek, play, rate 1.5, rate 1)\n');
  row(['mode', 'N', 'ctrl out B/s', 'sync p95 ms', 'rate fixes', 'seek fixes', 'rebuffers', 'media requests']);
  row(Array(8).fill('---'));
  for (const r of res.runs) {
    const c = r.commands;
    row([r.mode, r.n, c.ctrl.outBps, c.sync.errP95, c.corrections.rate, c.corrections.seek, c.rebuffers, c.mediaRequests]);
  }
  console.log('\n### Media max throughput (each guest downloads 32 MB at once)\n');
  row(['N', 'total Mbit/s', 'per guest min', 'per guest max', 'host CPU %', 'RSS MB']);
  row(Array(6).fill('---'));
  for (const t of res.throughput) row([t.n, t.totalMbps, t.perGuestMinMbps, t.perGuestMaxMbps, t.cpuPct, t.rssMb]);
  if (res.swiftThroughput?.length) {
    console.log('\n### Media max throughput, the app\'s Swift server (NearbyCore + MediaServer.swift)\n');
    row(['N', 'total Mbit/s', 'per guest min', 'per guest max', 'host CPU %', 'peak RSS MB']);
    row(Array(6).fill('---'));
    for (const t of res.swiftThroughput) row([t.n, t.totalMbps, t.perGuestMinMbps, t.perGuestMaxMbps, t.cpuPct, t.rssMb]);
  }
  console.log('\n### Shaped uplink (Wi-Fi model), streaming guests\n');
  row(['uplink Mbit/s', 'N', 'media Mbit/s', 'startup p50 ms', 'startup max ms', 'seek→play ms', 'rebuffers', 'stalled ms', 'sync p95 ms', 'clock p95 ms', 'rtt p50 ms', 'queue max ms']);
  row(Array(12).fill('---'));
  for (const r of res.shaped) {
    const s = r.steady;
    row([r.uplinkMbps, r.n, s.mediaMbps, r.join.startupP50, r.join.startupMax, r.commands.seekToPlayMs, s.rebuffers + r.commands.rebuffers, s.stalledMs, s.sync.errP95, s.sync.clockP95, s.sync.rttP50, s.shaperMaxDelay]);
  }
  console.log('\n### JSON encode + decode per message\n');
  row(['message', 'members', 'bytes', 'µs']);
  row(Array(4).fill('---'));
  for (const m of res.micro) row([m.message, m.n, m.bytes, m.encodeDecodeUs]);
  const r16 = res.runs.find((r: any) => r.mode === 'local' && r.n === 16);
  if (r16) {
    console.log('\n### Control by message type, local N=16, steady\n');
    row(['type', 'out/s', 'out B/s', 'avg bytes', 'in/s', 'in B/s']);
    row(Array(6).fill('---'));
    for (const [k, v] of Object.entries(r16.steady.ctrl.byType) as [string, any][]) row([k, v.outPerSec, v.outBps, v.avgOut, v.inPerSec, v.inBps]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
