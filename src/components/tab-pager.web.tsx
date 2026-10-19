/**
 * Web pager: a horizontal scroll view with paging (touch swipe and
 * trackpad), with the same tab strip as native.
 */
import { useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { TabStrip } from './tab-strip';
import type { TabPagerProps } from './tab-pager-types';

export function TabPager({ tabs, renderPage, initialIndex = 0, onIndexChange }: TabPagerProps) {
  const scrollRef = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(initialIndex);
  const [visited, setVisited] = useState(() => new Set([initialIndex]));
  const position = useSharedValue(initialIndex);

  const select = (i: number) => {
    if (i === index) return;
    setIndex(i);
    setVisited((v) => (v.has(i) ? v : new Set(v).add(i)));
    onIndexChange?.(i);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== width) {
      setWidth(w);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: index * w, animated: false }));
    }
  };

  const onPage = (page: number) => select(page);
  const onScroll = useAnimatedScrollHandler((e) => {
    if (width <= 0) return;
    const p = e.contentOffset.x / width;
    position.set(p);
    const page = Math.round(p);
    if (page !== index) scheduleOnRN(onPage, page);
  });

  return (
    <View style={styles.flex}>
      <TabStrip
        tabs={tabs}
        index={index}
        position={position}
        onPress={(i) => {
          select(i);
          scrollRef.current?.scrollTo({ x: i * width, animated: true });
        }}
      />
      <View style={styles.flex} onLayout={onLayout}>
        <Animated.ScrollView
          ref={scrollRef as never}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          style={styles.flex}>
          {tabs.map((t, i) => (
            <View key={t.key} style={{ width, flex: 1 }}>
              {width > 0 && visited.has(i) ? renderPage(t, i) : null}
            </View>
          ))}
        </Animated.ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
