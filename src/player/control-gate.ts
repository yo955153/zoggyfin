/**
 * The control gate. While a watch-together or listen-together session runs,
 * the user's play, pause, seek and speed controls (and, for audio, next,
 * previous, a jump in the queue, shuffle and repeat) go to the session
 * first. The session decides for the group and then changes the player
 * through `videoSession().direct` or `audioSession().direct`, which skip
 * the gate.
 *
 * While a session runs, the play button and Space follow what the group
 * wants (`groupPlaying`), not the engine. The engine is paused for a moment
 * before a planned start, while it waits for data, and (iOS) for a few
 * frames after each rate change of the drift correction. A tap in such a
 * moment used to send "play" to a group that played: the host then started
 * the group again, so the video paused for half a second and played on.
 */
import { create } from 'zustand';

import { usePlayerStore } from './store';

export type UserControl =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; position: number }
  | { action: 'rate'; rate: number }
  | { action: 'next' }
  | { action: 'previous' }
  | { action: 'jump'; key: string }
  | { action: 'shuffle'; on: boolean }
  | { action: 'repeat'; mode: 'off' | 'all' | 'one' };

/**
 * A guest of a listen-together session: the host owns the queue. Set by the
 * session; the audio session shows this text instead of a queue edit.
 */
let queueLock: string | null = null;

export const queueGate = {
  get locked(): string | null {
    return queueLock;
  },
  set(message: string | null): void {
    queueLock = message;
  },
};

/** Returns true when it took the control (the player must not apply it itself). */
export type ControlHandler = (control: UserControl) => boolean;

let handler: ControlHandler | null = null;

/** Play (true) or pause (false), as the group wants it; null when no session runs. */
export const useGroupPlaying = create<{ playing: boolean | null }>(() => ({ playing: null }));

export const controlGate = {
  get active(): boolean {
    return handler !== null;
  },
  intercept(control: UserControl): boolean {
    return handler ? handler(control) : false;
  },
  set(next: ControlHandler | null): void {
    handler = next;
    if (!next) useGroupPlaying.setState({ playing: null });
  },
  /** The session tells the gate what the group wants (after each change). */
  setPlaying(playing: boolean | null): void {
    const value = handler ? playing : null;
    if (useGroupPlaying.getState().playing !== value) useGroupPlaying.setState({ playing: value });
  },
};

/** True when the play button pauses (the group plays, or with no session, the engine plays). */
export function togglePauses(enginePlaying: boolean): boolean {
  return useGroupPlaying.getState().playing ?? enginePlaying;
}

/** For the play button: true shows "Pause". It follows the group while a session runs. */
export function useShowsPause(): boolean {
  const engine = usePlayerStore((s) => s.playing);
  const group = useGroupPlaying((s) => s.playing);
  return group ?? engine;
}
