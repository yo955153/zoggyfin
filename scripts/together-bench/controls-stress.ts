/**
 * Play button stress against the real desktop app: many fast taps on the
 * play button of the Mac app and of a scripted peer, then a check that each
 * tap did what the button showed and that no device left the asked state
 * (a transient resume or stop) before the next tap.
 *
 * The Mac app is a debug build started with ZOGGYFIN_AUTOMATION=<dir> and
 * signed in to a Jellyfin server (together-lab.tsx: `toggle`, `watch`).
 *
 *   nearby:   the Mac app hosts a room and plays the item; the peer joins
 *             over loopback with the real link, follower and play intent
 *             (src/together) and a simulated player.
 *   syncplay: the peer makes a SyncPlay group on the server (the user of
 *             JELLYFIN_* in the env file), the Mac app joins it, and both
 *             follow the server.
 *
 * Usage:
 *   pnpm dlx tsx@4.20.5 --tsconfig scripts/together-bench/tsconfig.json \
 *     scripts/together-bench/controls-stress.ts --mode nearby|syncplay --auto <dir> --item <id> \
 *     [--taps 50] [--who both|mac|peer] [--seed 1] [--env .env.local] [--min 100] [--max 1500]
 *
 * At the end the peer leaves (SyncPlay: it leaves the group and signs out,
 * and the script checks that the server lists no group). Exit code 1 when a
 * check fails.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { Follower } from '../../src/together/follower';
import { NearbyLink } from '../../src/together/link';
import { PlayIntent } from '../../src/together/play-intent';
import { realTimers } from '../../src/together/player-port';
import { NodeLinkNative } from './node-link';
import { SimPlayer } from './sim-player';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1]! : d;
};
const MODE = arg('mode', 'nearby') as 'nearby' | 'syncplay';
const AUTO = arg('auto', '');
const ITEM = arg('item', '');
const TAPS = Number(arg('taps', '50'));
const WHO = arg('who', 'both') as 'both' | 'mac' | 'peer';
const SEED = Number(arg('seed', '1'));
const MIN_GAP = Number(arg('min', '100'));
const MAX_GAP = Number(arg('max', '1500'));
const ENV = arg('env', '.env.local');
/** A device may leave the asked state for less than this, ms (a pause that crosses a planned start on the wire). */
const GLITCH_MS = Number(arg('glitch', '60'));
/** The peer's button reads its player, as the app did before play-intent.ts (to show the old behaviour). */
const LEGACY_PEER = args.includes('--legacy-peer');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!AUTO || !ITEM) {
  console.error('Set --auto (the ZOGGYFIN_AUTOMATION folder of the running Mac app) and --item (a video id).');
  process.exit(2);
}

// ---- Events ----------------------------------------------------------------------------

type Side = 'mac' | 'peer';
type Ev = { k: 'tap'; side: Side; t: number; i: number; sent: 'play' | 'pause' } | { k: 'eng'; side: Side; t: number; playing: boolean };
const events: Ev[] = [];

// ---- The Mac app (automation folder) -------------------------------------------------------

const cmdFile = path.join(AUTO, 'cmd.js');
const outFile = path.join(AUTO, 'out.log');
let outOffset = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;

/** Runs a script in the Mac app's page (the app picks up cmd.js every 200 ms). */
async function mac(js: string): Promise<void> {
  for (let i = 0; i < 100 && fs.existsSync(cmdFile); i++) await sleep(50);
  fs.writeFileSync(cmdFile, js);
  for (let i = 0; i < 100 && fs.existsSync(cmdFile); i++) await sleep(50);
}

/** Calls a together-lab action in the Mac app and returns its answer. */
async function lab(action: string, params: Record<string, string> = {}): Promise<string> {
  const id = Math.random().toString(36).slice(2);
  await mac(`(async () => {
    const log = (line) => window.__TAURI_INTERNALS__.invoke('debug_log', { line });
    try { log('lab ${id} ' + (await globalThis.__togetherLab(${JSON.stringify(action)}, ${JSON.stringify(params)}))); }
    catch (e) { log('lab ${id} error ' + e); }
  })();`);
  for (let i = 0; i < 400; i++) {
    const hit = readOut().find((l) => l.startsWith(`lab ${id} `));
    if (hit) return hit.slice(`lab ${id} `.length);
    await sleep(50);
  }
  return 'no answer';
}

let outLines: string[] = [];
/** New lines of out.log (kept, so callers can look again). */
function readOut(): string[] {
  if (!fs.existsSync(outFile)) return outLines;
  const size = fs.statSync(outFile).size;
  if (size > outOffset) {
    const fd = fs.openSync(outFile, 'r');
    const buf = Buffer.alloc(size - outOffset);
    fs.readSync(fd, buf, 0, buf.length, outOffset);
    fs.closeSync(fd);
    outOffset = size;
    outLines = outLines.concat(buf.toString('utf8').split('\n').filter(Boolean));
  }
  return outLines;
}

/** The Mac's taps, at fixed times (epoch ms), run in the page so the cmd.js pickup does not delay them. */
async function macSchedule(taps: { i: number; at: number }[]): Promise<void> {
  await mac(`(() => {
    const log = (o) => window.__TAURI_INTERNALS__.invoke('debug_log', { line: 'ctl ' + JSON.stringify(o) });
    for (const s of ${JSON.stringify(taps)}) {
      setTimeout(() => {
        const t = Date.now();
        globalThis.__togetherLab('toggle', {}).then((sent) => log({ k: 'tap', side: 'mac', i: s.i, t, sent }));
      }, Math.max(0, s.at - Date.now()));
    }
  })();`);
}

function macEvents(): Ev[] {
  return readOut()
    .filter((l) => l.startsWith('ctl '))
    .map((l) => JSON.parse(l.slice(4)) as Ev & { side?: Side })
    .map((e) => ({ ...e, side: 'mac' as const }));
}

// ---- Random schedule ---------------------------------------------------------------------

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x1_0000_0000;
  };
}

function schedule(start: number): { i: number; at: number; side: Side }[] {
  const rand = rng(SEED * 7919 + 17);
  const out: { i: number; at: number; side: Side }[] = [];
  let at = start;
  for (let i = 0; i < TAPS; i++) {
    const side: Side = WHO === 'both' ? (rand() < 0.5 ? 'mac' : 'peer') : WHO;
    out.push({ i, at, side });
    at += MIN_GAP + Math.floor(rand() * (MAX_GAP - MIN_GAP));
  }
  return out;
}

// ---- Peer: nearby guest --------------------------------------------------------------------

/** Finds the port of the Mac app's nearby session (Bonjour). */
async function findPort(): Promise<number> {
  const browse = spawn('dns-sd', ['-B', '_zgf-together._tcp', 'local.']);
  let text = '';
  browse.stdout.on('data', (d) => (text += String(d)));
  await sleep(2500);
  browse.kill();
  const names = [...text.matchAll(/ Add .*?_zgf-together\._tcp\.\s+(.+)$/gm)].map((m) => m[1]!.trim());
  for (const name of names) {
    const port = await new Promise<number | null>((resolve) => {
      const p = spawn('dns-sd', ['-L', name, '_zgf-together._tcp', 'local.']);
      let out = '';
      p.stdout.on('data', (d) => {
        out += String(d);
        const m = /can be reached at .*?:(\d+)/.exec(out);
        if (m) {
          p.kill();
          resolve(Number(m[1]));
        }
      });
      setTimeout(() => (p.kill(), resolve(null)), 2500);
    });
    if (port) return port;
  }
  throw new Error('No nearby session found (is the Mac app hosting?)');
}

interface Peer {
  tap(i: number): void;
  stop(): Promise<void>;
}

async function nearbyPeer(port: number): Promise<Peer> {
  const native = new NodeLinkNative(0);
  const link = new NearbyLink(native, realTimers, { joinTimeout: 60_000 });
  const now = () => native.monotonicNow();
  let follower: Follower | null = null;
  let player: SimPlayer | null = null;
  let poll: NodeJS.Timeout | null = null;
  link.open();
  const up = new Promise<void>((resolve) => {
    link.setHandlers({
      onPeerUp: (peer) => {
        const f = new Follower({ send: (m) => link.send(m, [peer]), now, timers: realTimers });
        follower = f;
        f.start('Stress peer', [ITEM], { memberId: 'stress-peer', canHost: false });
        resolve();
      },
      onMessage: (_p, m, at) => {
        const f = follower;
        if (!f) return;
        f.receive(m, at);
        if (m.t === 'welcome' && !player) {
          setTimeout(() => {
            const a = f.groupAnchor;
            const h = f.hostNow();
            const start = a ? (h !== null && a.playing ? a.position + Math.max(0, h - a.hostTime) / 1000 : a.position) : 0;
            player = new SimPlayer(now, undefined, null, start);
            f.attach(player, true);
            // The simulated player moves (true) or not: what a viewer of the peer would see.
            let last = player.position();
            let moving: boolean | null = null;
            poll = setInterval(() => {
              const pos = player!.position();
              // Moving: a small step forward in 10 ms. A seek is a jump, not playback.
              const m2 = player!.isPlaying() && pos > last + 1e-6 && pos - last < 0.1;
              last = pos;
              if (m2 !== moving) {
                moving = m2;
                events.push({ k: 'eng', side: 'peer', t: Date.now(), playing: m2 });
              }
            }, 10);
          }, 300);
        }
      },
    });
  });
  link.join({ host: '127.0.0.1', port }, { v: 1, name: 'Stress peer', have: true, memberId: 'stress-peer' });
  // The Mac host accepts the request.
  void lab('accept');
  await up;
  for (let i = 0; i < 100 && !player; i++) await sleep(100);
  return {
    tap: (i) => {
      const f = follower!;
      // The peer's play button: what the group wants (play-intent.ts), as the app shows it.
      const sent = (LEGACY_PEER ? player!.isPlaying() : f.wantsPlay) ? 'pause' : 'play';
      events.push({ k: 'tap', side: 'peer', t: Date.now(), i, sent });
      f.request({ action: sent });
    },
    stop: async () => {
      if (poll) clearInterval(poll);
      follower?.leave();
      player?.dispose();
      await sleep(300);
      link.close();
    },
  };
}

// ---- Peer: SyncPlay client -------------------------------------------------------------------

function readEnv(file: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

async function syncPlayPeer(): Promise<Peer & { groupId: string; api: (p: string, body?: unknown) => Promise<unknown> }> {
  const env = readEnv(ENV);
  const base = env.JELLYFIN_URL!.replace(/\/$/, '');
  const device = 'zgf-stress-peer';
  const header = (t?: string) => `MediaBrowser Client="Zoggyfin stress", Device="stress", DeviceId="${device}", Version="1"${t ? `, Token="${t}"` : ''}`;
  const login = (await (
    await fetch(`${base}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: header() },
      body: JSON.stringify({ Username: env.JELLYFIN_USER, Pw: env.JELLYFIN_PASSWORD }),
    })
  ).json()) as { AccessToken: string };
  const token = login.AccessToken;
  const api = async (p: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: header(token) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  // The server clock (NTP style, one good sample is enough on a LAN).
  let offset = 0;
  {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const u = (await api('/GetUtcTime')) as { RequestReceptionTime: string; ResponseTransmissionTime: string };
      const t3 = Date.now();
      const rtt = t3 - t0;
      if (rtt < best) {
        best = rtt;
        offset = (Date.parse(u.RequestReceptionTime) - t0 + (Date.parse(u.ResponseTransmissionTime) - t3)) / 2;
      }
    }
  }
  const serverNow = () => Date.now() + offset;
  const intent = new PlayIntent(() => Date.now());
  let group: boolean | null = null;
  let playing = false;
  let position = 0;
  let since = Date.now();
  let playlistItemId = '';
  let startTimer: NodeJS.Timeout | null = null;
  const setPlaying = (p: boolean) => {
    if (p === playing) return;
    position = pos();
    since = Date.now();
    playing = p;
    events.push({ k: 'eng', side: 'peer', t: Date.now(), playing: p });
  };
  const pos = () => (playing ? position + (Date.now() - since) / 1000 : position);
  const ready = () =>
    api('/SyncPlay/Ready', { When: new Date(serverNow()).toISOString(), PositionTicks: Math.round(pos() * 1e7), IsPlaying: playing, PlaylistItemId: playlistItemId });

  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/socket?api_key=${token}&deviceId=${device}`);
  let groupId = '';
  const joined = new Promise<void>((resolve) => {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { MessageType: string; Data?: unknown };
      if (m.MessageType === 'ForceKeepAlive') ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
      if (m.MessageType === 'SyncPlayGroupUpdate') {
        const u = m.Data as { GroupId: string; Type: string; Data: unknown };
        if (u.Type === 'GroupJoined') {
          groupId = u.GroupId;
          resolve();
        }
        if (u.Type === 'PlayQueue') {
          const d = u.Data as { Playlist: { PlaylistItemId: string }[]; PlayingItemIndex: number; StartPositionTicks: number };
          playlistItemId = d.Playlist[d.PlayingItemIndex]?.PlaylistItemId ?? '';
          position = (d.StartPositionTicks ?? 0) / 1e7;
          void ready();
        }
      }
      if (m.MessageType === 'SyncPlayCommand') {
        const c = m.Data as { Command: string; When: string; PositionTicks: number };
        const at = Date.parse(c.When) - offset;
        if (startTimer) clearTimeout(startTimer);
        startTimer = null;
        if (c.Command === 'Unpause') {
          group = true;
          intent.group(true);
          if (!LEGACY_PEER && intent.holdsPause) return;
          startTimer = setTimeout(() => {
            position = c.PositionTicks / 1e7 + Math.max(0, Date.now() - at) / 1000;
            since = Date.now();
            setPlaying(true);
          }, Math.max(0, at - Date.now()));
        } else if (c.Command === 'Pause' || c.Command === 'Seek') {
          group = false;
          intent.group(false);
          setPlaying(false);
          position = c.PositionTicks / 1e7;
          if (c.Command === 'Seek') void ready();
        }
      }
    };
  });
  await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
  const keepAlive = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ MessageType: 'KeepAlive' })), 15_000);
  await api('/SyncPlay/New', { GroupName: 'Stress group' });
  await joined;
  return {
    groupId,
    api,
    tap: (i) => {
      const sent = (LEGACY_PEER ? playing : intent.value(group)) ? 'pause' : 'play';
      events.push({ k: 'tap', side: 'peer', t: Date.now(), i, sent });
      intent.sent(sent === 'play');
      if (sent === 'pause' && !LEGACY_PEER) {
        // The app's player holds at once (anchor-follower `held`).
        if (startTimer) clearTimeout(startTimer);
        setPlaying(false);
      }
      void api(sent === 'play' ? '/SyncPlay/Unpause' : '/SyncPlay/Pause', {});
    },
    stop: async () => {
      clearInterval(keepAlive);
      if (startTimer) clearTimeout(startTimer);
      await api('/SyncPlay/Leave', {});
      ws.close();
      await api('/Sessions/Logout', {});
    },
  };
}

// ---- Analysis ----------------------------------------------------------------------------

function analyse(all: Ev[]): { wrong: string[]; glitches: string[]; final: Record<Side, boolean | null>; intended: boolean } {
  const sorted = [...all].sort((a, b) => a.t - b.t);
  const taps = sorted.filter((e): e is Extract<Ev, { k: 'tap' }> => e.k === 'tap');
  const wrong: string[] = [];
  const glitches: string[] = [];
  const state: Record<Side, boolean | null> = { mac: null, peer: null };
  const reached: Record<Side, boolean> = { mac: true, peer: true };
  const leftAt: Record<Side, number | null> = { mac: null, peer: null };
  let intended = true;
  const close = (s: Side, t: number) => {
    const from = leftAt[s];
    if (from !== null && t - from > GLITCH_MS) glitches.push(`${s} ${intended ? 'stopped' : 'resumed'} for ${t - from} ms (asked: ${intended ? 'play' : 'pause'})`);
    leftAt[s] = null;
  };
  let tapNo = 0;
  for (const e of sorted) {
    if (e.k === 'tap') {
      close('mac', e.t);
      close('peer', e.t);
      const want = !intended;
      if ((e.sent === 'play') !== want) wrong.push(`tap ${tapNo} on ${e.side}: sent ${e.sent}, the user wanted ${want ? 'play' : 'pause'}`);
      intended = e.sent === 'play';
      reached.mac = state.mac === intended;
      reached.peer = state.peer === intended;
      tapNo += 1;
      continue;
    }
    state[e.side] = e.playing;
    if (tapNo === 0) continue;
    if (e.playing === intended) {
      close(e.side, e.t);
      reached[e.side] = true;
    } else if (reached[e.side] && leftAt[e.side] === null) leftAt[e.side] = e.t;
  }
  const end = (sorted[sorted.length - 1]?.t ?? 0) + 1;
  close('mac', end);
  close('peer', end);
  if (taps.length !== TAPS) wrong.push(`${taps.length} of ${TAPS} taps were logged`);
  return { wrong, glitches, final: state, intended };
}

// ---- Main ----------------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`controls stress: ${MODE}, ${TAPS} taps from ${WHO}, gaps ${MIN_GAP}-${MAX_GAP} ms, seed ${SEED}`);
  readOut();
  console.log('mac watch:', await lab('watch'));
  let peer: Peer;
  let sp: Awaited<ReturnType<typeof syncPlayPeer>> | null = null;
  if (MODE === 'nearby') {
    console.log('mac room:', await lab('room'));
    await sleep(1500);
    console.log('mac play:', await lab('playitem', { item: ITEM }));
    await sleep(6000);
    const port = await findPort();
    console.log('nearby port', port);
    peer = await nearbyPeer(port);
    console.log('peer joined');
  } else {
    sp = await syncPlayPeer();
    peer = sp;
    console.log('group', sp.groupId);
    console.log('mac join:', await lab('spjoin', { group: sp.groupId }));
    await sleep(2000);
    await sp.api('/SyncPlay/SetNewQueue', { PlayingQueue: [ITEM], PlayingItemPosition: 0, StartPositionTicks: 0 });
    await sleep(8000);
    await sp.api('/SyncPlay/Unpause', {});
  }
  // Let the group play and settle.
  await sleep(6000);
  const start = Date.now() + 1500;
  const plan = schedule(start);
  await macSchedule(plan.filter((p) => p.side === 'mac'));
  const t0 = performance.now();
  for (const p of plan.filter((x) => x.side === 'peer')) {
    const wait = p.at - Date.now();
    if (wait > 0) await sleep(wait);
    peer.tap(p.i);
  }
  const last = plan[plan.length - 1]!.at;
  await sleep(Math.max(0, last - Date.now()) + 5000);
  console.log(`taps done in ${Math.round(performance.now() - t0)} ms`);
  const all = [...events, ...macEvents()];
  fs.writeFileSync(path.join(AUTO, `stress-${MODE}-${WHO}-${SEED}.json`), JSON.stringify(all));
  const r = analyse(all);
  await peer.stop();
  if (MODE === 'nearby') console.log('mac stop:', await lab('stop'));
  else {
    console.log('mac leave:', await lab('spleave'));
    await sleep(1000);
  }
  console.log(`wrong taps: ${r.wrong.length}`);
  r.wrong.forEach((w) => console.log('  ' + w));
  console.log(`glitches over ${GLITCH_MS} ms: ${r.glitches.length}`);
  r.glitches.forEach((g) => console.log('  ' + g));
  const finalOk = r.final.mac === r.intended && r.final.peer === r.intended;
  console.log(`final: asked ${r.intended ? 'play' : 'pause'}; mac ${r.final.mac ? 'plays' : 'paused'}, peer ${r.final.peer ? 'plays' : 'paused'}`);
  if (MODE === 'syncplay') await checkNoGroups();
  process.exit(r.wrong.length || r.glitches.length || !finalOk ? 1 : 0);
}

/** SyncPlay: the server lists no group after the run (the Mac app left, and the peer signed out). */
async function checkNoGroups(): Promise<void> {
  const env = readEnv(ENV);
  const base = env.JELLYFIN_URL!.replace(/\/$/, '');
  const header = (t?: string) => `MediaBrowser Client="Zoggyfin stress", Device="stress", DeviceId="zgf-stress-check", Version="1"${t ? `, Token="${t}"` : ''}`;
  const login = (await (
    await fetch(`${base}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: header() },
      body: JSON.stringify({ Username: env.JELLYFIN_USER, Pw: env.JELLYFIN_PASSWORD }),
    })
  ).json()) as { AccessToken: string };
  const list = await (await fetch(`${base}/SyncPlay/List`, { headers: { Authorization: header(login.AccessToken) } })).text();
  console.log('SyncPlay/List after the run:', list);
  await fetch(`${base}/Sessions/Logout`, { method: 'POST', headers: { Authorization: header(login.AccessToken) } });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
