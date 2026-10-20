/**
 * Binds the together controllers to the app's video player.
 *
 * The port remembers what it asked for (play or pause). When the player
 * changes by itself while it is not buffering (lock screen, Picture in
 * Picture, a headset button), `onOutside` gets that change as a control, so
 * the session can apply it for the group.
 */
import type { UserControl } from '@/player/control-gate';
import { videoSession } from '@/player/session';
import { playerState, usePlayerStore } from '@/player/store';

import type { PlayerPort } from './player-port';

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
export function bindVideoPort(onOutside?: (control: UserControl) => void, opts: { endPauses?: boolean } = {}): BoundPort {
  const direct = videoSession().direct;
  let intent = playerState().playing;
  let buffering = busy(playerState().status);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(b: boolean) => void>();

  const setBuffering = (b: boolean) => {
    if (b === buffering) return;
    buffering = b;
    listeners.forEach((l) => l(b));
  };

  const unsub = usePlayerStore.subscribe((s, prev) => {
    if (s.status !== prev.status) {
      if (busy(s.status)) {
        if (!timer) timer = setTimeout(() => ((timer = null), setBuffering(busy(playerState().status))), BUFFERING_DEBOUNCE);
      } else {
        if (timer) clearTimeout(timer);
        timer = null;
        setBuffering(false);
      }
    }
    if (s.status === 'ended' && prev.status !== 'ended' && intent) {
      intent = false;
      if (opts.endPauses) onOutside?.({ action: 'pause' });
      return;
    }
    if (s.playing !== prev.playing && s.playing !== intent && !busy(s.status) && s.status !== 'ended' && s.now) {
      intent = s.playing;
      onOutside?.({ action: s.playing ? 'play' : 'pause' });
    }
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
      if (timer) clearTimeout(timer);
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
