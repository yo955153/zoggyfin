/**
 * Pure SyncPlay helpers: Jellyfin's group commands and queue updates as
 * anchors and load targets. The server clock is the anchor clock (epoch ms).
 */
import { isoToMs } from './clock';
import type { Anchor } from './protocol';
import type { SyncPlayGroupView } from './store';

const TICKS_PER_SECOND = 10_000_000;

export const ticksToSeconds = (ticks: number | null | undefined) => (ticks ?? 0) / TICKS_PER_SECOND;
export const secondsToTicks = (seconds: number) => Math.max(0, Math.round(seconds * TICKS_PER_SECOND));

export interface SendCommandLike {
  Command?: 'Unpause' | 'Pause' | 'Stop' | 'Seek' | string;
  When?: string;
  PositionTicks?: number | null;
  PlaylistItemId?: string;
}

export type CommandEffect =
  | { kind: 'anchor'; anchor: Anchor; /** The server waits for a Ready after a seek. */ reportReady: boolean }
  | { kind: 'stop' }
  | { kind: 'ignore' };

/** What a SyncPlay command means for the player. */
export function commandEffect(cmd: SendCommandLike): CommandEffect {
  const when = isoToMs(cmd.When);
  const position = ticksToSeconds(cmd.PositionTicks);
  if (!Number.isFinite(when)) return cmd.Command === 'Stop' ? { kind: 'stop' } : { kind: 'ignore' };
  switch (cmd.Command) {
    case 'Unpause':
      return { kind: 'anchor', anchor: { playing: true, rate: 1, hostTime: when, position }, reportReady: false };
    case 'Pause':
      return { kind: 'anchor', anchor: { playing: false, rate: 1, hostTime: when, position }, reportReady: false };
    case 'Seek':
      return { kind: 'anchor', anchor: { playing: false, rate: 1, hostTime: when, position }, reportReady: true };
    case 'Stop':
      return { kind: 'stop' };
    default:
      return { kind: 'ignore' };
  }
}

export interface QueueUpdateLike {
  Reason?: string;
  Playlist?: { ItemId?: string; PlaylistItemId?: string }[];
  PlayingItemIndex?: number;
  StartPositionTicks?: number;
  IsPlaying?: boolean;
}

export interface QueueTarget {
  itemId: string;
  playlistItemId: string;
  startSeconds: number;
  isPlaying: boolean;
  /** Item ids of the whole group queue, in order. */
  queue: string[];
  index: number;
}

/** The item the group plays now, or null for an empty queue. */
export function queueTarget(u: QueueUpdateLike): QueueTarget | null {
  const list = u.Playlist ?? [];
  const index = u.PlayingItemIndex ?? 0;
  const current = list[index];
  if (!current?.ItemId || !current.PlaylistItemId) return null;
  return {
    itemId: current.ItemId,
    playlistItemId: current.PlaylistItemId,
    startSeconds: ticksToSeconds(u.StartPositionTicks),
    isPlaying: u.IsPlaying ?? false,
    queue: list.map((x) => x.ItemId ?? '').filter(Boolean),
    index,
  };
}

export interface GroupInfoLike {
  GroupId?: string;
  GroupName?: string;
  State?: string;
  Participants?: string[];
}

export function groupView(g: GroupInfoLike): SyncPlayGroupView | null {
  if (!g.GroupId) return null;
  return { id: g.GroupId, name: g.GroupName || 'Group', state: g.State ?? 'Idle', participants: g.Participants ?? [] };
}

/** The label of a group state for the session sheet. */
export function groupStateLabel(state: string): string {
  switch (state) {
    case 'Playing':
      return 'Playing';
    case 'Paused':
      return 'Paused';
    case 'Waiting':
      return 'Waiting for everyone';
    default:
      return 'Nothing playing';
  }
}
