import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Touchable } from '@/components/touchable';

import { motion, player, radius, spacing, textStyle, type } from './tokens';

/**
 * Skip Intro / Skip Credits (design-system §7.8): shows during the segment,
 * even with the controls hidden. TV: it takes the focus while the controls
 * are hidden (`preferredFocus`), so Select skips.
 */
export function SkipPill({
  label,
  onPress,
  preferredFocus,
  onFocusChange,
}: {
  label: string;
  onPress: () => void;
  preferredFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)}>
      <Touchable
        kind="button"
        radius={radius.pill}
        onPress={onPress}
        hasTVPreferredFocus={preferredFocus}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <Text style={styles.text}>{label}</Text>
      </Touchable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: player.skipPill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  text: { ...textStyle(type.headline), fontSize: 15, color: player.skipPillText },
});
