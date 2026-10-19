import { FlashList } from '@shopify/flash-list';
import type { ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useOpenItem } from '@/lib/navigation';
import { colors, GUTTER, spacing } from '@/theme';

import { Tile, type TileShape } from './tile';

/** Columns for a shape and screen width; phones get 3 posters or 2 wide tiles. */
export function gridColumns(shape: TileShape, screenWidth: number): number {
  const min = shape === 'landscape' ? 160 : shape === 'poster' ? 104 : 150;
  return Math.max(2, Math.floor((screenWidth - GUTTER * 2 + spacing.md) / (min + spacing.md)));
}

interface ItemGridProps {
  items: BaseItemDto[];
  shape: TileShape;
  onEndReached?: () => void;
  isFetchingMore?: boolean;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Overrides the default "open item" press. */
  onPress?: (item: BaseItemDto) => void;
  /** Insets for a grid under a transparent or large-title header. Default true. */
  autoInset?: boolean;
}

/** A virtualized grid of tiles (FlashList), sized to fill the width. */
export function ItemGrid({
  items,
  shape,
  onEndReached,
  isFetchingMore,
  ListHeaderComponent,
  ListEmptyComponent,
  refreshing,
  onRefresh,
  onPress,
  autoInset = true,
}: ItemGridProps) {
  const { width } = useWindowDimensions();
  const openItem = useOpenItem();
  const open = onPress ?? openItem;
  const columns = gridColumns(shape, width);
  const tileWidth = Math.floor((width - GUTTER * 2 - spacing.md * (columns - 1)) / columns);

  return (
    <FlashList
      data={items}
      numColumns={columns}
      key={columns}
      keyExtractor={(it, i) => it.Id ?? String(i)}
      contentInsetAdjustmentBehavior={autoInset ? 'automatic' : 'never'}
      contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: spacing.xxl * 2, paddingTop: autoInset ? 0 : spacing.lg }}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.8}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={isFetchingMore ? <ActivityIndicator style={styles.footer} color={colors.textSecondary} /> : null}
      renderItem={({ item, index }) => (
        // Equal gaps: each cell gives up the same share of the gutters.
        <View
          style={[
            styles.cell,
            {
              paddingLeft: ((index % columns) * spacing.md) / columns,
              paddingRight: ((columns - 1 - (index % columns)) * spacing.md) / columns,
            },
          ]}>
          <Tile item={item} width={tileWidth} shape={shape} onPress={open} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  cell: { marginBottom: spacing.lg },
  footer: { marginVertical: spacing.xl },
});
