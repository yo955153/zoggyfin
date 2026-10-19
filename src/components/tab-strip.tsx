import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Extrapolation, interpolate, type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { colors, GUTTER, size, spacing, type } from '@/theme';

import type { PagerTab } from './tab-pager-types';

interface Layout {
  x: number;
  width: number;
}

/**
 * The tab strip over a pager. `position` is the pager's live scroll position
 * (page index plus fraction), so the indicator follows the finger. It runs on
 * the UI thread (Reanimated) and moves only by transform.
 */
export function TabStrip({
  tabs,
  index,
  position,
  onPress,
}: {
  tabs: PagerTab[];
  index: number;
  position: SharedValue<number>;
  onPress: (index: number) => void;
}) {
  const [layouts, setLayouts] = useState<(Layout | undefined)[]>([]);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const ready = layouts.length === tabs.length && layouts.every(Boolean);

  useEffect(() => {
    const l = layouts[index];
    if (l) scrollRef.current?.scrollTo({ x: Math.max(0, l.x - GUTTER * 2), animated: true });
  }, [index, layouts]);

  const onLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((prev) => {
      const next = [...prev];
      next[i] = { x, width };
      return next;
    });
  };

  const inputRange = tabs.map((_, i) => i);
  const xs = layouts.map((l) => l?.x ?? 0);
  const widths = layouts.map((l) => l?.width ?? 0);
  const showIndicator = ready && tabs.length > 1;
  // A 1 pt bar scaled to the tab width: transforms only.
  const indicator = useAnimatedStyle(() => {
    if (!showIndicator) return { opacity: 0 };
    const p = position.get();
    return {
      opacity: 1,
      transform: [
        { translateX: interpolate(p, inputRange, xs, Extrapolation.CLAMP) },
        { scaleX: interpolate(p, inputRange, widths, Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <View style={styles.wrap}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <View style={styles.inner}>
          {tabs.map((t, i) => (
            <Pressable
              key={t.key}
              onLayout={onLayout(i)}
              onPress={() => onPress(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === index }}
              style={styles.tab}>
              <Text style={[styles.label, i === index && styles.labelActive]}>{t.title}</Text>
            </Pressable>
          ))}
          {tabs.length > 1 ? <Animated.View style={[styles.indicator, indicator]} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  row: { paddingHorizontal: GUTTER - spacing.sm },
  inner: { flexDirection: 'row' },
  tab: { paddingHorizontal: spacing.sm2, paddingVertical: spacing.md },
  label: { ...type.bodyStrong, color: colors.textSecondary },
  labelActive: { color: colors.text },
  indicator: { position: 'absolute', left: 0, bottom: 0, width: 1, height: size.indicator, backgroundColor: colors.accent, transformOrigin: 'left' },
});
