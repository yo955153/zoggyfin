/**
 * Binds the together controllers to the audio player (expo-audio queue on
 * iOS and Android, the web audio engine on the web and in the desktop app).
 *
 * - `bindAudioPort`: a PlayerPort over `audioSession().direct`, with the
 *   current queue entry (`track`). On the web it corrects drift by seeks only. Like the video binding, a play or pause
 *   from outside the app (lock screen, headset) goes to `onOutside`.
 * - `hostQueue`: the host's queue for the room (`RoomQueue`): a snapshot for
 *   the guests, the track and queue changes, and the queue actions.
 * - `toSharedQueue` / `fromSharedQueue`: the queue as the wire carries it.
 */
import { Platform } from 'react-native';

import type { UserControl } from '@/player/control-gate';
import type { AudioItem } from '@/player/audio/item';
import type { QueueState } from '@/player/audio/queue';
import { audioSession } from '@/player/audio/session';
import { useAudioStore } from '@/player/audio/store';
import { playerState, usePlayerStore } from '@/player/store';

import { SEEK_ONLY_DRIFT } from './drift';
import { OUTSIDE_CONFIRM, realTimers, type Timers } from './player-port';
import type { BoundPort } from './player-binding';
import { MAX_SHARED_ENTRIES, type SharedEntry, type SharedItem, type SharedQueue } from './protocol';
import type { QueueAction, RoomQueue } from './room';

const BUFFERING_DEBOUNCE = 400;

function busy(status: string): boolean {
  return status === 'loading' || status === 'buffering';
}

export function bindAudioPort(onOutside?: (control: UserControl) => void, opts: { timers?: Timers } = {}): BoundPort {
  const timers = opts.timers ?? realTimers;
  const direct = audioSession().direct;
  let intent = playerState().playing;
  let buffering = busy(playerState().status);
  let timer: unknown = null;
  const listeners = new Set<(b: boolean) => void>();
  let confirm: unknown = null;

  /** The player still differs from what the app asked: the change came from outside the app. */
  const confirmOutside = () => {
    confirm = null;
    const s = playerState();
    if (s.playing === intent || busy(s.status) || s.status === 'ended' || s.now?.kind !== 'audio') return;
    intent = s.playing;
    onOutside?.({ action: s.playing ? 'play' : 'pause' });
  };

  const setBuffering = (b: boolean) => {
    if (b === buffering) return;
    buffering = b;
    listeners.forEach((l) => l(b));
  };

  const unsub = usePlayerStore.subscribe((s, prev) => {
    if (s.status !== prev.status) {
      if (busy(s.status)) {
        if (!timer) timer = timers.setTimeout(() => ((timer = null), setBuffering(busy(playerState().status))), BUFFERING_DEBOUNCE);
      } else {
        if (timer) timers.clearTimeout(timer);
        timer = null;
        setBuffering(false);
      }
    }
    if (s.playing !== prev.playing && s.playing !== intent && !confirm) confirm = timers.setTimeout(confirmOutside, OUTSIDE_CONFIRM);
  });

  return {
    position: () => direct.position(),
    isPlaying: () => intent,
    resync: () => {
      intent = playerState().playing;
    },
    isBuffering: () => buffering,
    play: () => {
      intent = true;
      direct.play();
    },
    pause: () => {
      intent = false;
      direct.pause();
    },
    seek: (s) => direct.seek(s),
    setRate: (r) => direct.rate(r),
    track: () => direct.track(),
    // The web audio element loses time on each rate change (see drift.ts).
    drift: Platform.OS === 'web' ? SEEK_ONLY_DRIFT : undefined,
    onBuffering: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose: () => {
      unsub();
      if (timer) timers.clearTimeout(timer);
      if (confirm) timers.clearTimeout(confirm);
      listeners.clear();
    },
  };
}

/** The facts of an audio item for the guests. `path` and `art` are the host's URL paths, or null. */
export function sharedAudioItem(item: AudioItem, paths: { path: string | null; art: string | null }): SharedItem {
  return {
    id: item.Id,
    serverId: item.ServerId ?? null,
    name: item.Name ?? 'Track',
    type: item.Type ?? 'Audio',
    runTimeTicks: item.RunTimeTicks ?? null,
    mediaSourceId: item.MediaSources?.[0]?.Id ?? null,
    container: item.Container ?? null,
    album: item.Album ?? null,
    artist: item.Artists?.filter(Boolean).join(', ') || item.AlbumArtist || null,
    path: paths.path,
    art: paths.art,
  };
}

/** A guest's queue item from the shared facts. */
export function audioItemOf(s: SharedItem): AudioItem {
  return {
    Id: s.id,
    ServerId: s.serverId ?? undefined,
    Name: s.name,
    Type: s.type as AudioItem['Type'],
    MediaType: 'Audio',
    RunTimeTicks: s.runTimeTicks ?? undefined,
    Album: s.album ?? undefined,
    Artists: s.artist ? [s.artist] : undefined,
    Container: s.container ?? undefined,
    MediaSources: s.mediaSourceId ? [{ Id: s.mediaSourceId }] : undefined,
  };
}

/**
 * The shared form of a queue: at most `MAX_SHARED_ENTRIES` entries around
 * the current one (most of them after it).
 */
export function toSharedQueue(q: QueueState<AudioItem>, longForm: boolean, item: (entry: { key: string; item: AudioItem }) => SharedItem): SharedQueue {
  if (q.index < 0 || !q.entries.length) return { entries: [], index: -1, shuffle: q.shuffle, repeat: q.repeat, longForm };
  const before = Math.min(q.index, Math.floor(MAX_SHARED_ENTRIES / 5));
  const start = q.index - before;
  const slice = q.entries.slice(start, start + MAX_SHARED_ENTRIES);
  const entries: SharedEntry[] = slice.map((e) => ({ key: e.key, item: item(e) }));
  return { entries, index: before, shuffle: q.shuffle, repeat: q.repeat, longForm };
}

/** The guest's queue from the shared form. The keys stay the host's, so a track change names the same entry on both. */
export function fromSharedQueue(s: SharedQueue): QueueState<AudioItem> {
  const entries = s.entries.map((e) => ({ key: e.key, item: audioItemOf(e.item), user: false }));
  return { entries, index: s.index, original: entries.map((e) => e.key), shuffle: s.shuffle, repeat: s.repeat, source: null };
}

/** A short text that changes when the order, the entries or the play modes change (not the current index). */
export function queueSignature(q: QueueState<AudioItem>): string {
  return `${q.shuffle ? 1 : 0}${q.repeat}|${q.entries.map((e) => e.key).join(',')}`;
}

/**
 * The host's queue for the room. `item` gives the shared facts of an entry
 * (with the URL paths of the host's files).
 */
export function hostQueue(item: (entry: { key: string; item: AudioItem }) => SharedItem): RoomQueue & { dispose(): void } {
  const session = audioSession();
  const unsubs: (() => void)[] = [];
  return {
    snapshot: () => {
      const a = useAudioStore.getState();
      return toSharedQueue(a.queue, a.longForm, item);
    },
    track: () => {
      const a = useAudioStore.getState();
      return a.queue.entries[a.queue.index]?.key ?? null;
    },
    onTrack: (listener) => {
      const u = session.onTrackChange(listener);
      unsubs.push(u);
      return u;
    },
    onQueue: (listener) => {
      let sig = queueSignature(useAudioStore.getState().queue);
      const u = useAudioStore.subscribe((s) => {
        const next = queueSignature(s.queue);
        if (next === sig) return;
        sig = next;
        listener();
      });
      unsubs.push(u);
      return u;
    },
    apply: (c: QueueAction) => {
      const d = session.direct;
      switch (c.action) {
        case 'next':
          d.next();
          return;
        case 'previous':
          d.previous();
          return;
        case 'jump':
          d.jump(c.key);
          return;
        case 'shuffle':
          d.shuffle(c.on);
          return;
        case 'repeat':
          d.repeat(c.mode);
          return;
      }
    },
    dispose: () => {
      unsubs.forEach((u) => u());
      unsubs.length = 0;
    },
  };
}

/**
 * A guest on the entry before the group's entry, close to its end: the
 * gapless change comes by itself in a moment, so the guest waits for it
 * instead of a load (a load makes a gap). Returns the ms to wait, or null to
 * move now.
 */
export function waitForGapless(input: { queue: SharedQueue | null; playerTrack: string | null; groupTrack: string; remaining: number | null; rate: number }): number | null {
  const q = input.queue;
  if (!q || !input.playerTrack || input.remaining === null) return null;
  const at = q.entries.findIndex((e) => e.key === input.playerTrack);
  const next = at >= 0 ? q.entries[at + 1] : undefined;
  if (next?.key !== input.groupTrack) return null;
  const ms = (input.remaining / Math.max(0.25, input.rate)) * 1000;
  return ms <= 2000 ? ms + 500 : null;
}
