/**
 * Web pager: a horizontal scroll view with paging (touch swipe and
 * trackpad), with the same tab strip as native.
 */
import { useRef, useState } from 'react';
import { Animated, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, View } from 'react-native';

import { TabStrip } from './tab-strip';
import type { TabPagerProps } from './tab-pager-types';

export function TabPager({ tabs, renderPage, initialIndex = 0, onIndexChange }: TabPagerProps) {
  const scrollRef = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(initialIndex);
  const [visited, setVisited] = useState(() => new Set([initialIndex]));
  const scrollX = useState(() => new Animated.Value(0))[0];
  // scrollX / width, as an interpolation so the strip gets one type on both platforms.
  const w = Math.max(1, width);
  const position = scrollX.interpolate({ inputRange: [0, w], outputRange: [0, 1], extrapolate: 'extend' });

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

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: false,
    listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width > 0) select(Math.round(e.nativeEvent.contentOffset.x / width));
    },
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
