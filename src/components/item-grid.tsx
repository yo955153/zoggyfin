import { FlashList } from '@shopify/flash-list';
import { type ReactElement, useCallback, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useOpenItem } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { gridLayout, spacing, useLayout, useTheme } from '@/theme';

import { Tile, type TileShape } from './tile';

interface ItemGridProps {
  items: BaseItemDto[];
  shape: TileShape;
  onEndReached?: () => void;
  isFetchingMore?: boolean;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  /** Pull to refresh. The spinner shows only for a pull, not for background refetches. */
  onRefresh?: () => unknown;
  /** Overrides the default "open item" press. */
  onPress?: (item: BaseItemDto) => void;
  /** Insets for a grid under a transparent or large-title header. Default true. */
  autoInset?: boolean;
}

/**
 * A virtualized grid of tiles (FlashList). Columns come from the width the
 * grid really has (`gridFor` in the theme), so a sidebar, Split View or the
 * TV rail give the right column count. `key` changes with the column count,
 * so FlashList rebuilds once instead of animating cells.
 */
export function ItemGrid({
  items,
  shape,
  onEndReached,
  isFetchingMore,
  ListHeaderComponent,
  ListEmptyComponent,
  onRefresh,
  onPress,
  autoInset = true,
}: ItemGridProps) {
  const l = useLayout();
  const { c } = useTheme();
  const openItem = useOpenItem();
  const pull = usePullRefresh(onRefresh);
  const open = onPress ?? openItem;
  const [measured, setMeasured] = useState(0);
  const width = measured || l.contentWidth;
  const g = gridLayout(shape, width, l.tv, l.width);
  const { columns, tileWidth, gap, gutter } = g;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== measured) setMeasured(w);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: BaseItemDto; index: number }) => (
      // Equal gaps: each cell gives up the same share of the gaps.
      <View
        style={{
          marginBottom: gap + spacing.sm,
          paddingLeft: ((index % columns) * gap) / columns,
          paddingRight: ((columns - 1 - (index % columns)) * gap) / columns,
        }}>
        <Tile item={item} width={tileWidth} shape={shape} onPress={open} preferredFocus={l.tv && index === 0} />
      </View>
    ),
    [columns, gap, tileWidth, shape, open, l.tv],
  );

  return (
      <FlashList
        onLayout={onLayout}
        data={items}
        numColumns={columns}
        key={columns}
        keyExtractor={(it, i) => it.Id ?? String(i)}
        contentInsetAdjustmentBehavior={autoInset ? 'automatic' : 'never'}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: spacing.huge * 2, paddingTop: autoInset ? spacing.xs : spacing.lg }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.8}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        ListFooterComponent={isFetchingMore ? <ActivityIndicator style={styles.footer} color={c.text2} /> : null}
        renderItem={renderItem}
      />
  );
}

const styles = StyleSheet.create({
  footer: { marginVertical: spacing.xl },
});
