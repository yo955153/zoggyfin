import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { BaseItemDto } from '@/api/types';
import { ItemImage } from '@/components/item-image';
import { Touchable } from '@/components/touchable';
import { episodeLabel } from '@/lib/format';
import { NEXT_UP_COUNTDOWN_SECONDS } from '@/player/segments';

import { Glass } from './glass';
import { c, motion, radius, spacing, textStyle, type } from './tokens';

const RING = 36;
const STROKE = 3;

/** A ring that fills clockwise from the top over `seconds` (two clipped halves, transforms only). */
function CountdownRing({ seconds, paused }: { seconds: number; paused: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (paused) return;
    p.set(withTiming(1, { duration: seconds * 1000, easing: Easing.linear }));
  }, [p, seconds, paused]);
  const right = useAnimatedStyle(() => ({ transform: [{ rotate: `${-135 + Math.min(180, p.get() * 360)}deg` }] }));
  const left = useAnimatedStyle(() => ({ transform: [{ rotate: `${-135 + Math.max(0, Math.min(180, p.get() * 360 - 180))}deg` }] }));
  return (
    <View style={styles.ring}>
      <View style={[styles.circle, styles.track]} />
      <View style={[styles.half, { left: RING / 2 }]}>
        <Animated.View style={[styles.circle, styles.arcRight, { left: -RING / 2 }, right]} />
      </View>
      <View style={[styles.half, { left: 0 }]}>
        <Animated.View style={[styles.circle, styles.arcLeft, left]} />
      </View>
    </View>
  );
}

/**
 * The next-episode card (design-system §7.8): the next episode's thumb and a
 * 10 s countdown ring, with "Play Now" and "Cancel". When the countdown ends,
 * `onPlay` runs. TV: "Play Now" takes the focus while the controls are
 * hidden (`preferredFocus`); Right reaches "Cancel".
 */
export function NextUpCard({
  next,
  onPlay,
  onCancel,
  autoplay,
  preferredFocus,
  onFocusChange,
}: {
  next: BaseItemDto;
  onPlay: () => void;
  onCancel: () => void;
  autoplay: boolean;
  preferredFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  const [left, setLeft] = useState(NEXT_UP_COUNTDOWN_SECONDS);
  const fired = useRef(false);
  useEffect(() => {
    if (!autoplay) return;
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = Math.max(0, NEXT_UP_COUNTDOWN_SECONDS - (Date.now() - started) / 1000);
      setLeft(Math.ceil(remaining));
      if (remaining <= 0 && !fired.current) {
        fired.current = true;
        clearInterval(id);
        onPlay();
      }
    }, 250);
    return () => clearInterval(id);
  }, [autoplay, onPlay]);

  const label = [episodeLabel(next), next.Name].filter(Boolean).join(' · ');
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)}>
      <Glass variant="regular" style={styles.card}>
        <ItemImage item={next} variant="landscape" width={128} aspectRatio={16 / 9} rounded={radius.sm} hideArtTitle />
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Up Next</Text>
          <Text style={styles.title} numberOfLines={2}>
            {label || 'Next episode'}
          </Text>
          <View style={styles.actions}>
            <Touchable
              kind="button"
              radius={radius.pill}
              onPress={onPlay}
              hasTVPreferredFocus={preferredFocus}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              accessibilityRole="button"
              accessibilityLabel={autoplay ? `Play now. Starts in ${left} seconds` : 'Play now'}
              style={({ pressed }) => [styles.play, pressed && styles.pressed]}>
              <Text style={styles.playText}>Play Now</Text>
            </Touchable>
            <Touchable
              kind="button"
              radius={radius.sm}
              onPress={onCancel}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Touchable>
          </View>
        </View>
        {autoplay ? (
          <View style={styles.ringWrap} accessible={false}>
            <CountdownRing seconds={NEXT_UP_COUNTDOWN_SECONDS} paused={false} />
            <Text style={styles.ringText}>{left}</Text>
          </View>
        ) : null}
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    maxWidth: 440,
  },
  body: { flexShrink: 1, gap: spacing.xs },
  eyebrow: { ...textStyle(type.caption2), color: c.textOnMediaSecondary, textTransform: 'uppercase' },
  title: { ...textStyle(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  play: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
  },
  playText: { ...textStyle(type.subheadline), fontWeight: '600', color: '#111114' },
  cancel: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm },
  cancelText: { ...textStyle(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  pressed: { opacity: 0.75 },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringText: { ...textStyle(type.mono), color: c.textOnMedia, position: 'absolute', fontVariant: ['tabular-nums'] },
  ring: { width: RING, height: RING, position: 'absolute' },
  half: { position: 'absolute', top: 0, width: RING / 2, height: RING, overflow: 'hidden' },
  circle: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: STROKE },
  track: { borderColor: 'rgba(255,255,255,0.28)' },
  arcRight: { borderColor: 'transparent', borderTopColor: c.accent, borderRightColor: c.accent },
  arcLeft: { borderColor: 'transparent', borderBottomColor: c.accent, borderLeftColor: c.accent },
});
