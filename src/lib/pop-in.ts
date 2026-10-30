/**
 * When a "pop in" plays: the rules behind `usePopIn`. A view animates only
 * when its value moves into a state while it stays on screen for the same
 * thing. The first render never animates (content that is already in the
 * state did not just change), and a new scope (a recycled list cell that now
 * shows another item) only resets. Pure, so it is unit-tested.
 */

export type PopInFrame<T> = { scope: string | null | undefined; value: T };

/** `play` starts the animation; `rest` jumps to the end state; `none` leaves it alone. */
export type PopInStep = 'play' | 'rest' | 'none';

export function popInStep<T>(prev: PopInFrame<T> | null, next: PopInFrame<T>, enters: (prev: T, next: T) => boolean): PopInStep {
  if (!prev) return 'none';
  if (prev.scope !== next.scope) return 'rest';
  if (Object.is(prev.value, next.value)) return 'none';
  return enters(prev.value, next.value) ? 'play' : 'rest';
}

/** A toggle that turns on: false to true. `undefined` (not a toggle) never counts. */
export function turnedOn(prev: boolean | undefined, next: boolean | undefined): boolean {
  return prev === false && next === true;
}
