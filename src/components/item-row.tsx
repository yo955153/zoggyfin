import { FlashList } from '@shopify/flash-list';
import { useCallback, useContext } from 'react';
import { Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { Icon } from '@/components/icon';
import { BillboardRows, showOnBillboard } from '@/features/tv/billboard';
import { useOpenItem } from '@/lib/navigation';
import { createStyles, type AppTheme, font, iconSize, scaled, sizes, spacing, tvFocusBleed, type, useLayout, useStyles, useTheme } from '@/theme';

import { Delayed, SkeletonBlock, SkeletonText } from './skeleton';
import { ErrorState } from './states';
import { Tile, tileHeight, type TileShape, tileAspect } from './tile';
import { Touchable } from './touchable';

interface ItemRowProps {
  title: string;
  items: BaseItemDto[] | undefined;
  shape: TileShape;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** The header opens the full list. */
  onSeeAll?: () => void;
  /** Hide the row when it has no items (Home rows). */
  hideWhenEmpty?: boolean;
  tileTitle?: (item: BaseItemDto) => string | null | undefined;
  tileSubtitle?: (item: BaseItemDto) => string | null | undefined;
  /** Titles on the artwork (Continue watching). */
  titleOnArt?: boolean;
  /** TV: the first tile of this row takes the first focus. */
  preferredFocus?: boolean;
  /** Override the tile press. */
  onPress?: (item: BaseItemDto) => void;
}

/**
 * A Home shelf (design system §7.4): a header button, then a row that
 * scrolls freely with momentum. No paging, no snap: the last tile is cut at
 * the edge, which shows that the row goes on.
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
  titleOnArt,
  preferredFocus,
  onPress,
}: ItemRowProps) {
  const s = useStyles(makeStyles);
  const open = useOpenItem();
  const l = useLayout();
  const width = l.rowTile[shape === 'thumb' ? 'thumb' : shape];
  const press = onPress ?? open;
  // TV Home: art-only tiles; the billboard above shows the focused one.
  const billboard = useContext(BillboardRows) && l.tv;
  const artOnly = billboard && !titleOnArt;

  const renderItem = useCallback(
    ({ item, index }: { item: BaseItemDto; index: number }) => (
      <View style={{ marginRight: l.gap }}>
      <Tile
        item={item}
        width={width}
        shape={shape}
        onPress={press}
        title={tileTitle?.(item)}
        subtitle={tileSubtitle ? tileSubtitle(item) : undefined}
        titleOnArt={titleOnArt}
        preferredFocus={preferredFocus && index === 0}
        artOnly={artOnly}
        onFocusItem={billboard ? showOnBillboard : undefined}
      />
      </View>
    ),
    [width, shape, press, tileTitle, tileSubtitle, titleOnArt, preferredFocus, l.gap, artOnly, billboard],
  );

  if (error && !items?.length) {
    return (
      <View style={[s.section, { marginTop: l.sectionGap }]}>
        <RowHeader title={title} />
        <ErrorState error={error} onRetry={() => onRetry?.()} compact />
      </View>
    );
  }
  if (!isLoading && !items?.length && hideWhenEmpty) return null;

  const artHeight = width / tileAspect(shape);
  // TV: room above and below for the focus scale and ring; a horizontal list clips at its edges.
  const padV = l.tv ? tvFocusBleed(tileHeight(shape, width, !titleOnArt && !artOnly)) : spacing.xs;
  return (
    <View style={[s.section, { marginTop: l.sectionGap }]}>
      <RowHeader title={title} onSeeAll={onSeeAll} />
      {isLoading && !items ? (
        <Delayed>
          <View style={[s.skeletonRow, { paddingHorizontal: l.gutter, gap: l.gap }]}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={{ width }}>
                <SkeletonBlock width={width} height={artHeight} radius={shape === 'circle' ? width / 2 : shape === 'square' ? 8 : 10} />
                {titleOnArt ? null : <SkeletonText width={width} />}
              </View>
            ))}
          </View>
        </Delayed>
      ) : (
        <FlashList
          horizontal
          data={items ?? []}
          keyExtractor={(it, i) => it.Id ?? String(i)}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentContainerStyle={{ paddingLeft: l.gutter, paddingRight: l.gutter - l.gap, paddingVertical: padV }}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

/** Section header: `title3` and a chevron. The whole header is the button; no "See all" text. */
export function RowHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const text = (
    <>
      <Text style={s.title} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {onSeeAll ? <Icon name="chevron.right" size={scaled(iconSize.sm)} color={c.text3} weight="semibold" /> : null}
    </>
  );
  if (!onSeeAll) return <View style={[s.header, { paddingHorizontal: l.gutter }]}>{text}</View>;
  return (
    <View style={[s.headerWrap, { paddingHorizontal: l.gutter }]}>
      <Touchable
        onPress={onSeeAll}
        radius={8}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint="Opens the full list"
        style={s.headerButton}>
        {text}
      </Touchable>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  section: {},
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs, marginBottom: sizes.sectionHeaderGap },
  headerWrap: { flexDirection: 'row' as const, marginBottom: sizes.sectionHeaderGap },
  headerButton: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs, flexShrink: 1 },
  title: { ...font(type.title3), color: c.text, flexShrink: 1 },
  skeletonRow: { flexDirection: 'row' as const, overflow: 'hidden' as const },
}));
