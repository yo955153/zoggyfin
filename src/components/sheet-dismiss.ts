/** A drag down by this many points, or a fast flick, closes a sheet. */
export const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 800;

/** True when a drag down that ended here closes the sheet. */
export function shouldDismiss(translationY: number, velocityY: number): boolean {
  'worklet';
  return translationY > DISMISS_DISTANCE || (translationY > 12 && velocityY > DISMISS_VELOCITY);
}
