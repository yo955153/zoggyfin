import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, ScrollView, View } from 'react-native';
import Animated, { Extrapolation, interpolate, interpolateColor, type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { createStyles, type AppTheme, font, scaled, sizes, type, useLayout, useStyles, useTheme } from '@/theme';

import type { PagerTab } from './tab-pager-types';
import { Touchable } from './touchable';

interface Layout {
  x: number;
  width: number;
}

/**
 * The tab strip over a pager (design system §7.7). `position` is the pager's
 * live position (page index plus fraction), so the 3 pt `accent` bar and the
 * label colours follow the finger on the UI thread, with no React render.
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
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const [layouts, setLayouts] = useState<(Layout | undefined)[]>([]);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const ready = layouts.length === tabs.length && layouts.every(Boolean);

  useEffect(() => {
    const t = layouts[index];
    if (t) scrollRef.current?.scrollTo({ x: Math.max(0, t.x - l.gutter * 2), animated: true });
  }, [index, layouts, l.gutter]);

  const onLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((prev) => {
      const next = [...prev];
      next[i] = { x, width };
      return next;
    });
  };

  const inputRange = tabs.map((_, i) => i);
  const xs = layouts.map((t) => t?.x ?? 0);
  const widths = layouts.map((t) => t?.width ?? 0);
  const showIndicator = ready && tabs.length > 1;
  // An absolute, childless bar: its width can animate without a layout pass for anything else.
  const indicator = useAnimatedStyle(() => {
    if (!showIndicator) return { opacity: 0 };
    const p = position.get();
    return {
      opacity: 1,
      width: interpolate(p, inputRange, widths, Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(p, inputRange, xs, Extrapolation.CLAMP) }],
    };
  });

  return (
    <View style={s.wrap} accessibilityRole="tablist">
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: l.gutter }}>
        <View style={s.inner}>
          {tabs.map((t, i) => (
            <Touchable
              key={t.key}
              onLayout={onLayout(i)}
              onPress={() => onPress(i)}
              radius={6}
              accessibilityRole="tab"
              accessibilityLabel={t.title}
              accessibilityState={{ selected: i === index }}
              style={s.tab}>
              <Label title={t.title} index={i} position={position} from={c.text2} to={c.text} />
            </Touchable>
          ))}
          {tabs.length > 1 ? <Animated.View style={[s.indicator, indicator]} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Label({ title, index, position, from, to }: { title: string; index: number; position: SharedValue<number>; from: string; to: string }) {
  const s = useStyles(makeStyles);
  const color = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(position.get() - index));
    return { color: interpolateColor(d, [0, 1], [to, from]) };
  });
  return <Animated.Text style={[s.label, color]}>{title}</Animated.Text>;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  inner: { flexDirection: 'row' as const, gap: scaled(sizes.pagerGap) },
  tab: { height: scaled(sizes.pagerStripHeight), justifyContent: 'center' as const },
  label: { ...font(type.subheadline), fontWeight: '600' as const },
  indicator: {
    position: 'absolute' as const,
    left: 0,
    bottom: 0,
    height: sizes.pagerIndicator,
    borderRadius: sizes.pagerIndicator / 2,
    backgroundColor: c.accent,
  },
}));
