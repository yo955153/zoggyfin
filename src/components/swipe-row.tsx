import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { features } from '@/platform/tv';
import { font, motion, spacing, type, useTheme } from '@/theme';

import { Icon } from './icon';

/** How far the red area slides in behind the row. */
const REVEAL = 600;

/**
 * Swipe left to delete (design system §7.10, §7.11). The red area with the
 * label follows the finger; past the threshold the row slides away and
 * `onSwipe` runs. The caller confirms and removes. Screen readers and
 * keyboards use the row's own Delete action.
 */
export function SwipeRow({
  children,
  onSwipe,
  label = 'Delete',
  enabled = true,
}: {
  children: ReactNode;
  onSwipe: () => void | Promise<boolean | void>;
  label?: string;
  enabled?: boolean;
}) {
  const { c } = useTheme();
  const x = useSharedValue(0);
  const reset = () => {
    x.set(withSpring(0, motion.spring.snappy));
  };
  const fire = async () => {
    const result = await onSwipe();
    // A cancelled confirm brings the row back.
    if (result === false) reset();
  };
  const pan = Gesture.Pan()
    .enabled(enabled && features.touchGestures)
    .activeOffsetX([-16, 1000])
    .failOffsetY([-12, 12])
    .onUpdate((e) => x.set(Math.min(0, e.translationX)))
    .onEnd((e) => {
      if (e.translationX < -110 || e.velocityX < -900) {
        x.set(withTiming(-REVEAL, { duration: motion.duration.fast }));
        scheduleOnRN(fire);
      } else {
        x.set(withSpring(0, { ...motion.spring.snappy, velocity: e.velocityX }));
      }
    });
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const behindStyle = useAnimatedStyle(() => ({ transform: [{ translateX: REVEAL + x.get() }] }));
  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.behind, { backgroundColor: c.danger }, behindStyle]} pointerEvents="none">
        <Icon name="trash" size={18} color="#FFFFFF" />
        <Text style={styles.label}>{label}</Text>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  behind: {
    ...StyleSheet.absoluteFill,
    left: undefined,
    width: REVEAL,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.xl,
  },
  label: { ...font(type.subheadline), fontWeight: '600', color: '#FFFFFF' },
});
