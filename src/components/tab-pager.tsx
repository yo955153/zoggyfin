/**
 * A swipeable pager with a tab strip that follows the swipe (native:
 * react-native-pager-view). Web uses tab-pager.web.tsx.
 *
 * The scroll position goes to a Reanimated shared value on the UI thread.
 */
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView, { type PagerViewOnPageScrollEventData, type PagerViewProps } from 'react-native-pager-view';
import Animated, { useEvent, useSharedValue } from 'react-native-reanimated';

import { TabStrip } from './tab-strip';
import type { TabPagerProps } from './tab-pager-types';

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

export function TabPager({ tabs, renderPage, initialIndex = 0, onIndexChange }: TabPagerProps) {
  const pagerRef = useRef<PagerView>(null);
  const [index, setIndex] = useState(initialIndex);
  const [visited, setVisited] = useState(() => new Set([initialIndex]));
  const position = useSharedValue(initialIndex);

  const onPageScroll = useEvent<PagerViewOnPageScrollEventData>(
    (e) => {
      'worklet';
      position.set(e.position + e.offset);
    },
    ['onPageScroll'],
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
        // Reanimated's processed handler runs on the UI thread; its type differs from the prop's.
        onPageScroll={onPageScroll as unknown as PagerViewProps['onPageScroll']}
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
