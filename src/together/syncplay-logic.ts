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
  | {
      kind: 'anchor';
      anchor: Anchor;
      /** The server waits for a Ready after a seek. */
      reportReady: boolean;
      /** The group queue entry that the command applies to (audio: the anchor's track). */
      track?: string;
    }
  | { kind: 'stop' }
  | { kind: 'ignore' };

/** What a SyncPlay command means for the player. */
export function commandEffect(cmd: SendCommandLike): CommandEffect {
  const when = isoToMs(cmd.When);
  const position = ticksToSeconds(cmd.PositionTicks);
  if (!Number.isFinite(when)) return cmd.Command === 'Stop' ? { kind: 'stop' } : { kind: 'ignore' };
  const track = cmd.PlaylistItemId ? { track: cmd.PlaylistItemId } : {};
  switch (cmd.Command) {
    case 'Unpause':
      return { kind: 'anchor', anchor: { playing: true, rate: 1, hostTime: when, position }, reportReady: false, ...track };
    case 'Pause':
      return { kind: 'anchor', anchor: { playing: false, rate: 1, hostTime: when, position }, reportReady: false, ...track };
    case 'Seek':
      return { kind: 'anchor', anchor: { playing: false, rate: 1, hostTime: when, position }, reportReady: true, ...track };
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
  ShuffleMode?: string;
  RepeatMode?: string;
}

export interface QueueTarget {
  itemId: string;
  playlistItemId: string;
  startSeconds: number;
  isPlaying: boolean;
  /** Item ids of the whole group queue, in order. */
  queue: string[];
  index: number;
  /** The whole queue with the group's entry ids (an item can be in it twice). */
  entries: { itemId: string; playlistItemId: string }[];
  /** The index of the current entry in `entries`. */
  entryIndex: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  reason: string | null;
}

/** The item the group plays now, or null for an empty queue. */
export function queueTarget(u: QueueUpdateLike): QueueTarget | null {
  const list = u.Playlist ?? [];
  const index = u.PlayingItemIndex ?? 0;
  const current = list[index];
  if (!current?.ItemId || !current.PlaylistItemId) return null;
  const entries = list.filter((x) => x.ItemId && x.PlaylistItemId).map((x) => ({ itemId: x.ItemId as string, playlistItemId: x.PlaylistItemId as string }));
  return {
    itemId: current.ItemId,
    playlistItemId: current.PlaylistItemId,
    startSeconds: ticksToSeconds(u.StartPositionTicks),
    isPlaying: u.IsPlaying ?? false,
    queue: list.map((x) => x.ItemId ?? '').filter(Boolean),
    index,
    entries,
    entryIndex: Math.max(0, entries.findIndex((e) => e.playlistItemId === current.PlaylistItemId)),
    shuffle: u.ShuffleMode === 'Shuffle',
    repeat: u.RepeatMode === 'RepeatAll' ? 'all' : u.RepeatMode === 'RepeatOne' ? 'one' : 'off',
    reason: u.Reason ?? null,
  };
}

/** The same group queue (entries and order) as before: a track change only, no new queue for the audio player. */
export function sameQueue(a: QueueTarget | null, b: QueueTarget): boolean {
  if (!a || a.entries.length !== b.entries.length) return false;
  return a.entries.every((e, i) => e.playlistItemId === b.entries[i]?.playlistItemId);
}

/** SyncPlay's names of the play modes. */
export function syncPlayRepeat(mode: 'off' | 'all' | 'one'): 'RepeatNone' | 'RepeatAll' | 'RepeatOne' {
  return mode === 'all' ? 'RepeatAll' : mode === 'one' ? 'RepeatOne' : 'RepeatNone';
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

/**
 * The group after a `UserJoined` update, before the server's list comes.
 * The server lists each user once, so a name that is in the list already
 * changes nothing. The count is right at once, with no wait for a request.
 */
export function withUserJoined(g: SyncPlayGroupView, name: string | null): SyncPlayGroupView {
  if (!name) return { ...g, stale: true };
  if (g.participants.includes(name)) return g;
  return { ...g, participants: [...g.participants, name] };
}

/**
 * The group after a `UserLeft` update. The user can still be in the group
 * on another device, so the count is not known until the server's list comes.
 */
export function withUserLeft(g: SyncPlayGroupView): SyncPlayGroupView {
  return { ...g, stale: true };
}

/** The number of people for the room bar, or null when it is not known (show no count). */
export function groupCount(g: SyncPlayGroupView): number | null {
  return g.stale || g.participants.length === 0 ? null : g.participants.length;
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
