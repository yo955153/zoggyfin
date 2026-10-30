import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * A circular progress ring drawn with two clipped half-circle arcs (no SVG).
 * Each half shows a coloured 180° border arc, turned by the progress.
 *
 * Download progress arrives in steps, so the ring tweens between them on the
 * UI thread. A step back (a new or restarted download) jumps: a ring that
 * runs backwards would read as lost progress. The tween stays on with
 * Reduced Motion: it is a value readout that turns in place, not motion
 * across the screen.
 */
export function ProgressRing({
  size,
  width = 2,
  progress,
  color,
  track,
}: {
  size: number;
  width?: number;
  progress: number;
  color: string;
  track: string;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const shown = useSharedValue(p);
  const target = useRef(p);
  useEffect(() => {
    if (p < target.current) shown.set(p);
    else if (p > target.current) shown.set(withTiming(p, { duration: 400, easing: Easing.linear }));
    target.current = p;
  }, [p, shown]);

  const rightArc = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-135 + 180 * Math.min(1, shown.get() * 2)}deg` }],
  }));
  // The left arc is always coloured and only shows past half way: opacity, so it can animate.
  const leftArc = useAnimatedStyle(() => {
    const left = Math.max(0, shown.get() * 2 - 1);
    return { opacity: left > 0 ? 1 : 0, transform: [{ rotate: `${-135 + 180 * left}deg` }] };
  });

  const circle = { position: 'absolute' as const, top: 0, width: size, height: size, borderRadius: size / 2, borderWidth: width };
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={[circle, { left: 0, borderColor: track }]} />
      <View style={{ position: 'absolute', left: size / 2, top: 0, width: size / 2, height: size, overflow: 'hidden' }}>
        <Animated.View
          style={[circle, { left: -size / 2, borderColor: 'transparent', borderTopColor: color, borderRightColor: color }, rightArc]}
        />
      </View>
      <View style={{ position: 'absolute', left: 0, top: 0, width: size / 2, height: size, overflow: 'hidden' }}>
        <Animated.View
          style={[circle, { left: 0, borderColor: 'transparent', borderBottomColor: color, borderLeftColor: color }, leftArc]}
        />
      </View>
    </View>
  );
}
