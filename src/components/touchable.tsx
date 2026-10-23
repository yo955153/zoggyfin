import { type ComponentRef, type ReactNode, type Ref, useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { forgetContentFocus, rememberContentFocus } from '@/features/tv/focus';
import { focusFromKeyboard } from '@/lib/input-modality';
import { isTV } from '@/platform/tv';
import { mediaColors, motion, tv, useTheme, webPressable } from '@/theme';

export type TouchKind = 'tile' | 'button' | 'icon' | 'row' | 'plain';

export interface TouchState {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
}

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  /** Feedback style (design system §6.2 and §7.3). */
  kind?: TouchKind;
  /** Corner radius of the element, for the overlay and the focus ring. */
  radius?: number;
  /** Style of the element itself (layout, background). */
  style?: StyleProp<ViewStyle> | ((s: TouchState) => StyleProp<ViewStyle>);
  /** Style of the outer press area (flex, margins). */
  containerStyle?: StyleProp<ViewStyle>;
  children?: ReactNode | ((s: TouchState) => ReactNode);
  /** Draw the focus ring on keyboard and TV focus. Default true. */
  ring?: boolean;
  ref?: Ref<ComponentRef<typeof View>>;
}

const STANDARD = Easing.bezier(...motion.easing.standard);

function pressScale(kind: TouchKind): number {
  if (kind === 'tile') return motion.press.tileScale;
  if (kind === 'icon') return motion.press.buttonScale;
  if (kind === 'button') return 0.98;
  return 1;
}

/**
 * Press, hover and focus feedback for every control. Feedback starts on
 * press-in; the release settles with the `snappy` spring. Tiles lift on hover
 * and focus (scale + `raised` shadow); the focus ring is 2 pt `focusRing`
 * with a 2 pt gap. TV: a white ring with a glow and the focus scale; the
 * last focused control is remembered for the side menu (features/tv/focus).
 * Reduce Motion keeps the overlays and drops the scale.
 */
export function Touchable({
  kind = 'plain',
  radius = 0,
  style,
  containerStyle,
  children,
  ring = true,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  disabled,
  ref,
  ...rest
}: TouchableProps) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const state: TouchState = { pressed, hovered, focused };

  // TV: keep a handle on the view, so the side menu can give the focus back to it.
  const own = useRef<ComponentRef<typeof View> | null>(null);
  const setRef = useCallback(
    (v: ComponentRef<typeof View> | null) => {
      own.current = v;
      if (typeof ref === 'function') ref(v);
      else if (ref) (ref as { current: ComponentRef<typeof View> | null }).current = v;
    },
    [ref],
  );
  useEffect(() => {
    const box = own;
    return () => forgetContentFocus(box.current);
  }, []);

  const lifts = kind === 'tile' || (isTV && kind !== 'row' && kind !== 'plain');
  const restScale = (h: boolean, f: boolean) => {
    if (reduced || !lifts) return 1;
    if (f && isTV) return tv.focusScale;
    return h || f ? motion.press.hoverScale : 1;
  };

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const ringWidth = isTV ? tv.focusRingWidth : 2;
  const ringGap = isTV ? tv.focusRingGap : 2;
  const showRing = ring && focused && !disabled;
  const lifted = lifts && (hovered || focused) && !disabled;

  const inner = typeof style === 'function' ? style(state) : style;

  return (
    <Pressable
      ref={setRef}
      disabled={disabled}
      onPressIn={(e) => {
        setPressed(true);
        if (!reduced) scale.set(withTiming(pressScale(kind), { duration: motion.duration.press, easing: STANDARD }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        scale.set(withSpring(restScale(hovered, focused), motion.spring.snappy));
        onPressOut?.(e);
      }}
      onHoverIn={(e) => {
        setHovered(true);
        scale.set(withTiming(restScale(true, focused), { duration: motion.duration.fast, easing: STANDARD }));
        onHoverIn?.(e);
      }}
      onHoverOut={(e) => {
        setHovered(false);
        scale.set(withTiming(restScale(false, focused), { duration: motion.duration.fast, easing: STANDARD }));
        onHoverOut?.(e);
      }}
      onFocus={(e) => {
        const visible = focusFromKeyboard();
        setFocused(visible);
        if (isTV) rememberContentFocus(own.current);
        if (visible) scale.set(withTiming(restScale(hovered, true), { duration: motion.duration.fast, easing: STANDARD }));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        scale.set(withTiming(restScale(hovered, false), { duration: motion.duration.fast, easing: STANDARD }));
        onBlur?.(e);
      }}
      accessibilityState={{ disabled: !!disabled, ...rest.accessibilityState }}
      style={[webPressable, disabled && styles.disabled, containerStyle]}
      {...rest}>
      <Animated.View style={[inner, animated, lifted && t.shadow('raised'), isTV && showRing && styles.tvGlow]}>
        {typeof children === 'function' ? children(state) : children}
        {kind === 'tile' || kind === 'button' || kind === 'icon' ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: radius },
              pressed ? styles.pressOverlay : hovered && !isTV ? styles.hoverOverlay : null,
            ]}
          />
        ) : null}
        {showRing ? (
          <View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                top: -(ringGap + ringWidth),
                left: -(ringGap + ringWidth),
                right: -(ringGap + ringWidth),
                bottom: -(ringGap + ringWidth),
                borderRadius: radius + ringGap + ringWidth,
                borderWidth: ringWidth,
                borderColor: isTV ? mediaColors.white : t.c.focusRing,
              },
            ]}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  pressOverlay: { backgroundColor: mediaColors.pressOverlay },
  hoverOverlay: { backgroundColor: mediaColors.hoverOverlay },
  ring: { position: 'absolute' },
  // TV: a soft white glow around the focused control (10-foot focus).
  tvGlow: {
    shadowColor: mediaColors.white,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
});
