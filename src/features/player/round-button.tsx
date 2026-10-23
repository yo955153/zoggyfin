import * as Haptics from 'expo-haptics';
import { type ReactNode, useState } from 'react';
import { findNodeHandle, Platform, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/icon';
import { type FocusTarget } from '@/features/tv/focus';
import { focusFromKeyboard } from '@/lib/input-modality';
import { isTV } from '@/platform/tv';
import { tv, webPressable } from '@/theme';

import { Glass } from './glass';
import { c, motion } from './tokens';

/**
 * A round glass button over video. Press-in scales to 0.92 (snappy spring
 * back); with Reduce Motion only the opacity changes. Keyboard focus draws a
 * ring around the circle only (TV: a white ring, and the button grows).
 */
export function RoundButton({
  icon,
  label,
  size,
  glyph,
  onPress,
  glass = true,
  haptic,
  style,
  children,
  preferredFocus,
  onFocusChange,
  nextFocusDown,
}: {
  icon?: IconName;
  label: string;
  size: number;
  glyph: number;
  onPress: () => void;
  glass?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** TV: take the focus when it mounts or when this turns true. */
  preferredFocus?: boolean;
  /** The button took (true) or lost (false) the focus. */
  onFocusChange?: (focused: boolean) => void;
  /** Android TV: the view that Down sends the focus to. */
  nextFocusDown?: FocusTarget | null;
}) {
  const pressed = useSharedValue(0);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const anim = useAnimatedStyle(() => {
    const p = pressed.get();
    return reduced
      ? { opacity: 1 - p * 0.3 }
      : { transform: [{ scale: 1 - p * (1 - motion.press.buttonScale) }] };
  });
  const focusRing = focused;
  const body = (
    <>
      {icon ? <Icon name={icon} size={glyph} color={c.textOnMedia} weight="semibold" /> : null}
      {children}
    </>
  );
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      hasTVPreferredFocus={preferredFocus}
      nextFocusDown={nextFocusDown && Platform.OS !== 'web' ? (findNodeHandle(nextFocusDown) ?? undefined) : undefined}
      onFocus={() => {
        setFocused(focusFromKeyboard());
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange?.(false);
      }}
      onPressIn={() => pressed.set(withTiming(1, { duration: motion.duration.press }))}
      onPressOut={() => pressed.set(withSpring(0, motion.spring.snappy))}
      onPress={() => {
        if (haptic && Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[webPressable, style]}>
      <View style={[styles.focusWrap, { borderRadius: size / 2 + (isTV ? tv.focusRingWidth * 2 : 4) }, focusRing && styles.focused]}>
        <Animated.View style={[round, anim]}>
          {glass ? (
            <Glass style={[styles.center, round]}>{body}</Glass>
          ) : (
            <Animated.View style={[styles.center, round]}>{body}</Animated.View>
          )}
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // A ring with a gap, drawn by the padded wrapper; transparent until focused.
  focusWrap: isTV
    ? { padding: tv.focusRingWidth, borderWidth: tv.focusRingWidth, borderColor: 'transparent', margin: -tv.focusRingWidth * 2 }
    : { padding: 2, borderWidth: 2, borderColor: 'transparent', margin: -4 },
  focused: isTV ? { borderColor: '#FFFFFF', transform: [{ scale: tv.focusScale }] } : { borderColor: '#FFFFFF' },
});
