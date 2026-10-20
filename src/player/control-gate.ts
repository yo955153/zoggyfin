/**
 * The control gate. While a watch-together or listen-together session runs,
 * the user's play, pause, seek and speed controls (and, for audio, next,
 * previous, a jump in the queue, shuffle and repeat) go to the session
 * first. The session decides for the group and then changes the player
 * through `videoSession().direct` or `audioSession().direct`, which skip
 * the gate.
 */

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

export const controlGate = {
  get active(): boolean {
    return handler !== null;
  },
  intercept(control: UserControl): boolean {
    return handler ? handler(control) : false;
  },
  set(next: ControlHandler | null): void {
    handler = next;
  },
};
