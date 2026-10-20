/**
 * The host's upload budget in a nearby session. Each guest that streams
 * from the host pulls its own copy of the file, so the host's upload is the
 * limit (docs/perf/together-bench.md, sections 2.5 and 4). Playback holds
 * while the streams use at most about 80 % of the path's real throughput.
 * Pure: facts in, numbers and texts out.
 */
import type { LinkAddress } from './link-native-types';
import type { Member } from './protocol';

/** How the host's media reaches the guests. */
export type TransportPath = 'wifi-phone' | 'wifi-mac' | 'ethernet' | 'awdl' | 'hotspot';

/**
 * A realistic media budget of each path, Mbit/s (the low end of the report's
 * table, section 4). A phone on 5 GHz Wi-Fi sends each byte over the air
 * twice (host to access point, access point to guest), so its budget is
 * about half of its link rate.
 */
export const PATH_BUDGET_MBPS: Record<TransportPath, number> = {
  'wifi-phone': 80,
  'wifi-mac': 100,
  ethernet: 150,
  awdl: 40,
  hotspot: 30,
};

/** The part of the budget that streams can use before guests stall. */
export const USABLE_SHARE = 0.8;

/** The bitrate when the host does not know it: the 1080p transcode (src/downloads/plan.ts). */
export const DEFAULT_BITRATE_MBPS = 8;

/** A file above this bitrate is "large": guests should download it. */
export const LARGE_FILE_MBPS = 15;

/** The path of the host from its addresses (link-native-types.ts) and its own hotspot. */
export function hostPath(i: { platform: 'ios' | 'android' | 'mac'; addresses: readonly LinkAddress[]; hotspot: boolean }): TransportPath {
  if (i.hotspot || i.addresses.some((a) => a.kind === 'hotspot')) return 'hotspot';
  if (i.platform === 'mac' && i.addresses.some((a) => a.kind === 'ethernet')) return 'ethernet';
  if (i.addresses.some((a) => a.kind === 'wifi')) return i.platform === 'mac' ? 'wifi-mac' : 'wifi-phone';
  if (i.addresses.some((a) => a.kind === 'ethernet')) return 'ethernet';
  // No network: Apple devices use peer-to-peer Wi-Fi (AWDL). An Android host with no network has a hotspot or nothing.
  return i.platform === 'android' ? 'hotspot' : 'awdl';
}

/** The bitrate of a file, Mbit/s, from its size and its run time. Null when one is unknown. */
export function fileBitrateMbps(bytes: number | null | undefined, runTimeTicks: number | null | undefined): number | null {
  if (!bytes || !runTimeTicks || bytes <= 0 || runTimeTicks <= 0) return null;
  return (bytes * 8) / (runTimeTicks / 10_000_000) / 1e6;
}

/** How many guests can stream from the host on this path at this bitrate (at least 1). */
export function streamBudget(path: TransportPath, bitrateMbps: number | null | undefined): number {
  const rate = bitrateMbps && bitrateMbps > 0 ? bitrateMbps : DEFAULT_BITRATE_MBPS;
  return Math.max(1, Math.floor((PATH_BUDGET_MBPS[path] * USABLE_SHARE) / rate));
}

/** The members that stream from the host now (no own copy, no server stream, connected). */
export function streamingFromHost(members: readonly Member[]): number {
  return members.filter((m) => !m.away && !m.local && !m.server).length;
}

export interface StreamWarning {
  /** `warning`: over the budget, playback may stutter. `note`: advice before the limit. */
  tone: 'warning' | 'note';
  text: string;
}

/**
 * The host's line about its upload, or null when all is well.
 * - Over the budget: "More than N people stream from you. Playback may stutter. Ask them to download first."
 * - On a hotspot, the hotspot has its own lines (the phone's one radio is also the network).
 * - A large file (an original) with streaming guests: they should download it.
 */
export function streamWarning(i: { path: TransportPath; bitrateMbps: number | null; streaming: number }): StreamWarning | null {
  if (i.streaming <= 0) return null;
  const n = streamBudget(i.path, i.bitrateMbps);
  if (i.path === 'hotspot') {
    if (i.streaming > n) {
      return { tone: 'warning', text: `More than ${n} ${people(n)} stream from your hotspot. Playback may stutter. Ask them to download first.` };
    }
    return { tone: 'note', text: `Guests on your hotspot should download the video first. Streaming from your phone works for ${n} ${n === 1 ? 'guest' : 'guests'} at most.` };
  }
  if (i.streaming > n) return { tone: 'warning', text: `More than ${n} ${people(n)} stream from you. Playback may stutter. Ask them to download first.` };
  if ((i.bitrateMbps ?? 0) > LARGE_FILE_MBPS) return { tone: 'note', text: 'This file is large. Guests should download it, or the group should use a lower quality download.' };
  return null;
}

function people(n: number): string {
  return n === 1 ? 'person' : 'people';
}
