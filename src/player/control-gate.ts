/**
 * The control gate. While a watch-together session runs, the user's play,
 * pause, seek and speed controls go to the session first. The session
 * decides for the group and then changes the player through
 * `videoSession().direct`, which skips the gate.
 */

export type UserControl =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; position: number }
  | { action: 'rate'; rate: number };

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
