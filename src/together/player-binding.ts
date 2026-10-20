/**
 * Binds the together controllers to the app's video player.
 *
 * The port remembers what it asked for (play or pause). When the player
 * changes by itself while it is not buffering (lock screen, Picture in
 * Picture, a headset button) and the change holds for `OUTSIDE_CONFIRM`,
 * `onOutside` gets that change as a control, so the session can apply it for
 * the group. A late engine report of the app's own command is not a change.
 */
import type { UserControl } from '@/player/control-gate';
import { videoSession } from '@/player/session';
import { playerState, usePlayerStore } from '@/player/store';

import { OUTSIDE_CONFIRM, type PlayerPort, realTimers, type Timers } from './player-port';

/** Buffering must last this long before the group waits for it. */
const BUFFERING_DEBOUNCE = 400;

export interface BoundPort extends PlayerPort {
  dispose(): void;
}

function busy(status: string): boolean {
  return status === 'loading' || status === 'buffering';
}

/**
 * `endPauses`: the host's port. When the film ends, it sends a pause to
 * `onOutside`, so the group stops at the end. A guest's port only notes it.
 */
export function bindVideoPort(onOutside?: (control: UserControl) => void, opts: { endPauses?: boolean; timers?: Timers } = {}): BoundPort {
  const timers = opts.timers ?? realTimers;
  const direct = videoSession().direct;
  let intent = playerState().playing;
  let buffering = busy(playerState().status);
  let timer: unknown = null;
  const listeners = new Set<(b: boolean) => void>();
  let confirm: unknown = null;

  /** The player still differs from what the app asked: the change came from outside the app. */
  const confirmOutside = () => {
    confirm = null;
    const s = playerState();
    if (s.playing === intent || busy(s.status) || s.status === 'ended' || !s.now) return;
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
    if (s.status === 'ended' && prev.status !== 'ended' && intent) {
      intent = false;
      if (opts.endPauses) onOutside?.({ action: 'pause' });
      return;
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

/** Resolves when the player has loaded (or failed). */
export function whenPlayerReady(timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      unsub();
      clearTimeout(t);
      resolve(ok);
    };
    const check = () => {
      const s = playerState();
      if (s.status === 'ready' || s.status === 'buffering') done(true);
      else if (s.status === 'error') done(false);
    };
    const unsub = usePlayerStore.subscribe(check);
    const t = setTimeout(() => done(false), timeoutMs);
    check();
  });
}
