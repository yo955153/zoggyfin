/**
 * A short arrival for a view whose value moves into a state while it is on
 * screen (a toggle that turns on, a download that completes). The view scales
 * from `from` to 1 on a spring, and fades in when `fade` is set. `popInStep`
 * (pure, tested) decides when it plays. Transform and opacity only, on the UI
 * thread. Reduced motion drops the scale and keeps the fade.
 *
 * `enters` and `opts` must be stable (module constants): they are effect deps.
 */
import { useLayoutEffect, useRef } from 'react';
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme';

import { type PopInFrame, popInStep } from './pop-in';

export type PopInOptions = {
  /** Start scale. Never 0: an arrival grows from close to its size. */
  from: number;
  spring: { duration: number; dampingRatio: number };
  /** Also fade in from 0 (an arrival of new content, not a toggle). */
  fade?: boolean;
};

/** Strong ease-out for the fade: fast start, soft landing. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * @param scope What the view shows (an item Id). A new scope only resets, so a
 *   recycled list cell never plays another item's change.
 * @param onPlay Runs in the same frame as the animation starts (a haptic).
 */
export function usePopIn<T>(
  value: T,
  enters: (prev: T, next: T) => boolean,
  opts: PopInOptions,
  scope?: string | null,
  onPlay?: () => void,
) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const last = useRef<PopInFrame<T> | null>(null);

  // A layout effect, so the start values are set before the new content paints.
  useLayoutEffect(() => {
    const next = { scope, value };
    const step = popInStep(last.current, next, enters);
    last.current = next;
    if (step === 'none') return;
    cancelAnimation(scale);
    cancelAnimation(opacity);
    if (step === 'rest') {
      scale.set(1);
      opacity.set(1);
      return;
    }
    if (!reduced) {
      scale.set(opts.from);
      scale.set(withSpring(1, opts.spring));
    }
    if (opts.fade) {
      opacity.set(0);
      // Opacity takes a timing curve: a spring with overshoot would pass 1.
      opacity.set(withTiming(1, { duration: reduced ? motion.reducedMotion.fade : motion.duration.base, easing: EASE_OUT }));
    }
    onPlay?.();
  }, [value, scope, enters, opts, reduced, onPlay, scale, opacity]);

  return useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
}
