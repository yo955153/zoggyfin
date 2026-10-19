/**
 * A swipeable pager with a tab strip that follows the swipe (native:
 * react-native-pager-view). Web uses tab-pager.web.tsx.
 */
import { useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';

import { TabStrip } from './tab-strip';
import type { TabPagerProps } from './tab-pager-types';

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

export function TabPager({ tabs, renderPage, initialIndex = 0, onIndexChange }: TabPagerProps) {
  const pagerRef = useRef<PagerView>(null);
  const [index, setIndex] = useState(initialIndex);
  const [visited, setVisited] = useState(() => new Set([initialIndex]));

  const scrollPosition = useState(() => new Animated.Value(initialIndex))[0];
  const scrollOffset = useState(() => new Animated.Value(0))[0];
  const position = useMemo(
    () =>
      Animated.add(scrollPosition, scrollOffset).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'extend' }),
    [scrollPosition, scrollOffset],
  );

  const onPageScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { position: scrollPosition, offset: scrollOffset } }], {
        useNativeDriver: true,
      }),
    [scrollPosition, scrollOffset],
  );

  const select = (i: number) => {
    setIndex(i);
    setVisited((v) => (v.has(i) ? v : new Set(v).add(i)));
    onIndexChange?.(i);
  };

  return (
    <View style={styles.flex}>
      <TabStrip tabs={tabs} index={index} position={position} onPress={(i) => pagerRef.current?.setPage(i)} />
      <AnimatedPagerView
        ref={pagerRef}
        style={styles.flex}
        initialPage={initialIndex}
        onPageScroll={onPageScroll}
        onPageSelected={(e: { nativeEvent: { position: number } }) => select(e.nativeEvent.position)}>
        {tabs.map((t, i) => (
          <View key={t.key} style={styles.flex} collapsable={false}>
            {visited.has(i) ? renderPage(t, i) : null}
          </View>
        ))}
      </AnimatedPagerView>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
