import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { motion, sizes, useTheme, withAlpha } from '@/theme';

/**
 * One shared shimmer value for every skeleton block (design system §7.13), so
 * all bands move together. It runs while at least one block is on screen.
 */
const shimmer = makeMutable(0);
let users = 0;

function useShimmer(active: boolean) {
  useEffect(() => {
    if (!active) return;
    users += 1;
    if (users === 1) {
      shimmer.set(0);
      shimmer.set(withRepeat(withTiming(1, { duration: motion.duration.skeletonCycle, easing: Easing.linear }), -1, false));
    }
    return () => {
      users -= 1;
      if (users === 0) cancelAnimation(shimmer);
    };
  }, [active]);
}

/** A `surface2` block at a real tile size, with the moving `surface3` band. */
export function SkeletonBlock({ width, height, radius = 0, style }: { width: number | `${number}%`; height: number; radius?: number; style?: ViewStyle }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  useShimmer(!reduced);
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: `${(shimmer.get() * 3 - 1.5) * 100}%` }] }));
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: c.surface2, overflow: 'hidden', borderCurve: 'continuous' }, style]}>
      {reduced ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, band]}>
          <LinearGradient
            colors={[withAlpha(c.surface3, 0), c.surface3, withAlpha(c.surface3, 0)]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/** Two 12 pt text bars (60 % and 40 % wide) under a tile. */
export function SkeletonText({ width }: { width: number }) {
  return (
    <View style={styles.text}>
      <SkeletonBlock width={width * 0.6} height={sizes.skeletonBar} radius={sizes.skeletonBar / 2} />
      <SkeletonBlock width={width * 0.4} height={sizes.skeletonBar} radius={sizes.skeletonBar / 2} />
    </View>
  );
}

/** Shows its children only after 150 ms, so fast loads never flash a skeleton. */
export function Delayed({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), sizes.skeletonDelay);
    return () => clearTimeout(t);
  }, []);
  return shown ? <>{children}</> : null;
}

const styles = StyleSheet.create({
  text: { gap: 6, marginTop: 8 },
});
