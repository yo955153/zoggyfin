import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { motion, player, radius, spacing, textStyle, type } from './tokens';

/** Skip Intro / Skip Credits (design-system §7.8): shows during the segment, even with the controls hidden. */
export function SkipPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <Text style={styles.text}>{label}</Text>
      </Pressable>
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
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  text: { ...textStyle(type.headline), fontSize: 15, color: player.skipPillText },
});
