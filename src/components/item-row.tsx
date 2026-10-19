import { FlashList } from '@shopify/flash-list';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useOpenItem } from '@/lib/navigation';
import { Icon } from '@/components/icon';
import { colors, GUTTER, iconSize, radius, spacing, type } from '@/theme';

import { ErrorState } from './states';
import { Tile, type TileShape, tileAspect } from './tile';

const WIDTHS: Record<TileShape, number> = { poster: 118, landscape: 232, square: 140, circle: 104 };

interface ItemRowProps {
  title: string;
  items: BaseItemDto[] | undefined;
  shape: TileShape;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSeeAll?: () => void;
  /** Hide the row when it has no items (Home rows). */
  hideWhenEmpty?: boolean;
  tileTitle?: (item: BaseItemDto) => string | null | undefined;
  tileSubtitle?: (item: BaseItemDto) => string | null | undefined;
}

/**
 * A titled row that scrolls sideways. It is a plain list with momentum
 * scrolling, not a paged carousel.
 */
export function ItemRow({
  title,
  items,
  shape,
  isLoading,
  error,
  onRetry,
  onSeeAll,
  hideWhenEmpty = true,
  tileTitle,
  tileSubtitle,
}: ItemRowProps) {
  const open = useOpenItem();
  const width = WIDTHS[shape];

  if (error && !items?.length) {
    return (
      <View style={styles.section}>
        <RowHeader title={title} />
        <ErrorState error={error} onRetry={() => onRetry?.()} compact />
      </View>
    );
  }
  if (!isLoading && !items?.length && hideWhenEmpty) return null;

  const height = width / tileAspect(shape) + 44;
  return (
    <View style={styles.section}>
      <RowHeader title={title} onSeeAll={onSeeAll} />
      {isLoading && !items ? (
        <View style={[styles.skeletonRow, { height }]}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.skeleton, { width, height: width / tileAspect(shape) }]} />
          ))}
        </View>
      ) : (
        <FlashList
          horizontal
          data={items ?? []}
          keyExtractor={(it, i) => it.Id ?? String(i)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: GUTTER }}
          ItemSeparatorComponent={Separator}
          renderItem={({ item }) => (
            <Tile
              item={item}
              width={width}
              shape={shape}
              onPress={open}
              title={tileTitle?.(item)}
              subtitle={tileSubtitle ? tileSubtitle(item) : undefined}
            />
          )}
        />
      )}
    </View>
  );
}

function Separator() {
  return <View style={{ width: spacing.md }} />;
}

export function RowHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={10} style={styles.seeAll} accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
          <Text style={styles.seeAllText}>See all</Text>
          <Icon name="chevron.right" size={iconSize.sm} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    marginBottom: spacing.sm2,
    gap: spacing.md,
  },
  title: { ...type.section, color: colors.text, flexShrink: 1 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  seeAllText: { ...type.callout, color: colors.textSecondary },
  skeletonRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: GUTTER, overflow: 'hidden' },
  skeleton: { backgroundColor: colors.surface, borderRadius: radius.md },
});
