import { FlashList } from '@shopify/flash-list';
import { type ReactElement, useCallback, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, RefreshControl, StyleSheet, View } from 'react-native';

import { usePrefetchItemOnFocus } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { useOpenItem } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { gridLayout, spacing, tvFocusBleed, useLayout, useTheme } from '@/theme';

import { refreshTint, useRefreshSpinner } from './refresh-spinner';
import { Tile, tileHeight, type TileShape } from './tile';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

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
  /** TV: the first tile takes the first focus. Off when the header holds rows of tiles above the grid. Default true. */
  focusFirstTile?: boolean;
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
  focusFirstTile = true,
}: ItemGridProps) {
  const l = useLayout();
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset });
  const { c } = useTheme();
  const openItem = useOpenItem();
  const pull = usePullRefresh(onRefresh);
  useRefreshSpinner(pull.refreshing);
  const open = onPress ?? openItem;
  const prefetch = usePrefetchItemOnFocus();
  const [measured, setMeasured] = useState(0);
  const width = measured || l.contentWidth;
  const g = gridLayout(shape, width, l.tv, l.width);
  const { columns, tileWidth, gap, gutter } = g;
  // TV: room above the first row for the focus scale and ring.
  const topPad = l.tv ? tvFocusBleed(tileHeight(shape, tileWidth)) + spacing.lg : autoInset ? spacing.xs : spacing.lg;

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
        <Tile
          item={item}
          width={tileWidth}
          shape={shape}
          onPress={open}
          preferredFocus={l.tv && focusFirstTile && index === 0}
          onFocusItem={l.tv ? prefetch : undefined}
        />
      </View>
    ),
    [columns, gap, tileWidth, shape, open, l.tv, prefetch, focusFirstTile],
  );

  return (
      <FlashList
        onLayout={onLayout}
        data={items}
        numColumns={columns}
        key={columns}
        keyExtractor={(it, i) => it.Id ?? String(i)}
        contentInsetAdjustmentBehavior={autoInset ? 'automatic' : 'never'}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomPad, paddingTop: topPad }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.8}
        refreshControl={pull.onRefresh ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text2)} /> : undefined}
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
