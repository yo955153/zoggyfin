import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { playedFraction, subtitleFor } from '@/lib/format';
import { Icon } from '@/components/icon';
import { colors, iconSize, radius, size, spacing, type } from '@/theme';

import { ItemImage } from './item-image';
import { SHAPES, shapeFor, type TileShape } from './tile-shape';

export { shapeFor, shapeForList, type TileShape } from './tile-shape';

export interface TileProps {
  item: BaseItemDto;
  width: number;
  shape?: TileShape;
  onPress: (item: BaseItemDto) => void;
  /** Override the title line. */
  title?: string | null;
  subtitle?: string | null;
  showProgress?: boolean;
}

export const Tile = memo(function Tile({ item, width, shape, onPress, title, subtitle, showProgress = true }: TileProps) {
  const s = SHAPES[shape ?? shapeFor(item)];
  const progress = showProgress ? playedFraction(item) : null;
  const played = item.UserData?.Played && item.Type !== 'MusicAlbum' && item.Type !== 'Audio';
  const titleText = title ?? (item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name) ?? '';
  const sub = subtitle !== undefined ? subtitle : item.Type === 'Episode' ? item.Name : subtitleFor(item);
  const circle = (shape ?? shapeFor(item)) === 'circle';

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[titleText, sub].filter(Boolean).join(', ')}>
      <View>
        <ItemImage item={item} variant={s.variant} width={width} aspectRatio={s.aspect} circle={circle} />
        {progress !== null ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
        {played ? (
          <View style={styles.played}>
            <Icon name="checkmark" size={iconSize.xs} color={colors.onImage} weight="bold" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.title, circle && styles.center]} numberOfLines={1}>
        {titleText}
      </Text>
      {sub ? (
        <Text style={[styles.subtitle, circle && styles.center]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
});

export function tileAspect(shape: TileShape): number {
  return SHAPES[shape].aspect;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  title: { ...type.tileTitle, color: colors.text, marginTop: spacing.xs2 },
  subtitle: { ...type.tileSubtitle, color: colors.textSecondary, marginTop: spacing.xxs / 2 },
  center: { textAlign: 'center' },
  progressTrack: {
    position: 'absolute',
    left: size.overlayInset,
    right: size.overlayInset,
    bottom: size.overlayInset,
    height: size.progressBar,
    borderRadius: radius.bar,
    backgroundColor: colors.progressTrack,
    overflow: 'hidden',
  },
  progressFill: { height: size.progressBar, backgroundColor: colors.progress },
  played: {
    position: 'absolute',
    top: size.badgeInset,
    right: size.badgeInset,
    width: size.badge,
    height: size.badge,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
