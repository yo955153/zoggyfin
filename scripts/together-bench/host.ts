/**
 * The host process of the benchmark: the real NearbyLink (link.ts) and the
 * real HostRoom (room.ts) on the Node transport (node-link.ts), with a
 * simulated player. The parent (bench.ts) sends commands over IPC.
 *
 * The host accepts each join request at once (in the app the host taps
 * "Accept"; a guest with the session key gets in with no tap).
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import { NearbyLink } from '../../src/together/link';
import { realTimers } from '../../src/together/player-port';
import type { ControlAction } from '../../src/together/protocol';
import { HostRoom } from '../../src/together/room';
import { NodeLinkNative, Shaper } from './node-link';
import { SimPlayer } from './sim-player';

const file = process.env.BENCH_FILE ?? '';
const bitrateMbps = Number(process.env.BENCH_BITRATE_MBPS ?? '8');
const legacy = process.env.BENCH_LEGACY === '1';
const uplink = Number(process.env.BENCH_UPLINK_MBPS ?? '0');
const shaper = uplink > 0 ? new Shaper(uplink * 1e6) : null;
const native = new NodeLinkNative(0, shaper);
const now = () => native.monotonicNow();
const player = new SimPlayer(now);
const MEDIA_PATH = '/0123456789abcdef01234567/1.mp4';
const KEY = 'bench-session-key';

const link = new NearbyLink(native, realTimers, { sessionKey: () => KEY });
let room: HostRoom | null = null;
const joinOpen = new Map<string, number>();
const joinLatency: number[] = [];

const elDelay = monitorEventLoopDelay({ resolution: 1 });
let cpu0 = process.cpuUsage();
let t0 = performance.now();
let elu0 = performance.eventLoopUtilization();

function resetStats(): void {
  native.counters.reset();
  cpu0 = process.cpuUsage();
  t0 = performance.now();
  elu0 = performance.eventLoopUtilization();
  elDelay.reset();
  joinLatency.length = 0;
  if (shaper) shaper.maxDelay = 0;
}

function stats() {
  const c = native.counters;
  const secs = (performance.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const elu = performance.eventLoopUtilization(elu0);
  const members = room?.memberList ?? [];
  return {
    secs,
    framesOut: c.framesOut,
    bytesOut: c.bytesOut,
    framesIn: c.framesIn,
    bytesIn: c.bytesIn,
    byType: c.byType,
    httpBytes: c.httpBytes,
    httpRequests: c.httpRequests,
    httpOpen: c.httpOpen,
    httpPeak: c.httpPeak,
    cpuPct: ((cpu.user + cpu.system) / 1e6 / secs) * 100,
    elu: elu.utilization,
    loopP99: elDelay.percentile(99) / 1e6,
    loopMax: elDelay.max / 1e6,
    rssMb: process.memoryUsage().rss / 1048576,
    heapMb: process.memoryUsage().heapUsed / 1048576,
    members: members.length,
    ready: members.filter((m) => !m.buffering && !m.away).length,
    waiting: room?.state.waiting ?? false,
    joinLatency: [...joinLatency],
    shaperMaxDelay: shaper?.maxDelay ?? 0,
    hostDrift: player.isPlaying() && room ? hostDrift() : null,
  };
}

/** The host player's position minus the group anchor (the host also starts late). */
function hostDrift(): number {
  const a = room!.state.anchor;
  const t = now();
  if (!a.playing || t < a.hostTime) return 0;
  return player.position() - (a.position + ((t - a.hostTime) / 1000) * a.rate);
}

async function main(): Promise<void> {
  link.open();
  const { port } = await native.startServer('zgf-bench', {});
  native.shareFile(MEDIA_PATH, file, 'video/mp4');
  // The app paces the host's file to its bitrate (nearby-media.ts). The throughput test has no pace.
  if (process.env.BENCH_PACE !== '0') native.setPace(MEDIA_PATH, (bitrateMbps * 1e6) / 8);
  room = new HostRoom(
    { send: (m, to) => link.send(m, to ?? null), now, player, timers: realTimers, ...(legacy ? {} : { pong: (peer: string, id: number, t0: number, t1: number) => link.sendPong(peer, id, t0, t1) }) },
    {
      sessionId: 'bench-session',
      item: { id: 'item-1', serverId: 'srv', name: 'Bench film', type: 'Movie', runTimeTicks: 2_000_000_000, container: 'mp4', path: MEDIA_PATH, art: null },
      stream: { service: 'zgf-bench', path: MEDIA_PATH },
      onlyHostControls: false,
      key: KEY,
      epoch: 0,
      hostId: 'host',
    },
  );
  link.setHandlers({
    onRequest: (e) => {
      joinOpen.set(e.peerId, performance.now());
      link.respond(e.peerId, true);
    },
    onMessage: (peer, m, at) => {
      room?.receive(peer, m, at);
      if (m.t === 'hello') {
        const t = joinOpen.get(peer);
        if (t !== undefined) joinLatency.push(performance.now() - t);
      }
    },
    onPeerDown: (peer) => room?.removeMember(peer),
  });
  elDelay.enable();
  process.send!({ type: 'ready', port, path: MEDIA_PATH, origin: performance.timeOrigin });
}

process.on('message', (msg: { cmd: string; id: number; action?: ControlAction }) => {
  const reply = (body: object) => process.send!({ type: 'reply', id: msg.id, ...body });
  switch (msg.cmd) {
    case 'control':
      room!.apply(msg.action!);
      reply({});
      return;
    case 'reset':
      resetStats();
      reply({});
      return;
    case 'stats':
      reply({ stats: stats() });
      return;
    case 'stop':
      room?.end();
      setTimeout(() => {
        native.stopAll();
        player.dispose();
        process.exit(0);
      }, 200);
      reply({});
      return;
  }
});

void main();
