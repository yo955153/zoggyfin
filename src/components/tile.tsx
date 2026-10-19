import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { DownloadBadge, downloadLabel } from '@/components/download-indicator';
import { Icon } from '@/components/icon';
import { useDownloadStatus } from '@/downloads';
import { playedFraction, remainingLabel, subtitleFor } from '@/lib/format';
import { createStyles,
  type AppTheme,
  font,
  iconSize,
  mediaColors,
  radius,
  scaled,
  scriptStyle,
  sizes,
  type,
  useStyles,
  useTheme,
} from '@/theme';

import { ItemImage } from './item-image';
import { SHAPES, shapeFor, type TileShape } from './tile-shape';
import { Touchable } from './touchable';

export { shapeFor, shapeForList, type TileShape } from './tile-shape';

export interface TileProps {
  item: BaseItemDto;
  width: number;
  shape?: TileShape;
  onPress: (item: BaseItemDto) => void;
  onLongPress?: (item: BaseItemDto) => void;
  /** Override the title line. */
  title?: string | null;
  subtitle?: string | null;
  showProgress?: boolean;
  /** Title and metadata on the artwork over a scrim (Continue watching). */
  titleOnArt?: boolean;
  /** TV: take the first focus on the screen. */
  preferredFocus?: boolean;
}

function radiusFor(shape: TileShape): number {
  return shape === 'square' ? radius.sm : radius.md;
}

/**
 * The media tile (design system §7.3): one picture, a title and one line of
 * metadata, a white progress bar on the art, at most one badge. Flat at rest;
 * it lifts with the `raised` shadow only on hover and focus.
 */
export const Tile = memo(function Tile({
  item,
  width,
  shape,
  onPress,
  onLongPress,
  title,
  subtitle,
  showProgress = true,
  titleOnArt = false,
  preferredFocus,
}: TileProps) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { fontScale } = useWindowDimensions();
  const kind = shape ?? shapeFor(item);
  const shapeInfo = SHAPES[kind];
  const circle = kind === 'circle';
  const r = circle ? width / 2 : radiusFor(kind);

  const progress = showProgress ? playedFraction(item) : null;
  const played = !!item.UserData?.Played && item.Type !== 'MusicAlbum' && item.Type !== 'Audio' && item.Type !== 'Series';
  const unplayed = item.Type === 'Series' ? item.UserData?.UnplayedItemCount ?? 0 : 0;
  const titleText = title ?? (item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name) ?? '';
  const sub = subtitle !== undefined ? subtitle : item.Type === 'Episode' ? item.Name : subtitleFor(item);
  const left = remainingLabel(item);
  const lines = fontScale >= 1.5 ? 2 : 1;
  const download = useDownloadStatus(item.Id);

  const label = [titleText, sub, progress !== null ? left : null, played ? 'played' : null, downloadLabel(download)].filter(Boolean).join(', ');

  return (
    <Touchable
      kind="tile"
      radius={r}
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={{ width }}>
      {() => (
        <>
          <View>
            <ItemImage
              item={item}
              variant={shapeInfo.variant}
              width={width}
              aspectRatio={shapeInfo.aspect}
              rounded={r}
              circle={circle}
              hideArtTitle={titleOnArt || progress !== null}
            />
            {titleOnArt ? (
              <View style={[StyleSheet.absoluteFill, s.artText, { borderRadius: r }]} pointerEvents="none">
                <LinearGradient
                  colors={[c.artScrimTop, c.artScrimBottom]}
                  locations={[0.4, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <Text style={[s.onArtTitle, scriptStyle(titleText, s.onArtTitle)]} numberOfLines={1}>
                  {titleText}
                </Text>
                {sub || left ? (
                  <Text style={s.onArtMeta} numberOfLines={1}>
                    {[sub, left].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {progress !== null ? <Progress fraction={progress} inline /> : null}
              </View>
            ) : progress !== null ? (
              <Progress fraction={progress} />
            ) : null}
            {download.state !== 'none' ? (
              // One badge per tile: the download state comes first.
              <DownloadBadge status={download} />
            ) : played ? (
              <View style={s.badge}>
                <Icon name="checkmark" size={iconSize.xs} color={mediaColors.white} weight="bold" />
              </View>
            ) : unplayed > 0 ? (
              <View style={[s.badge, s.countBadge]}>
                <Text style={s.count}>{unplayed}</Text>
              </View>
            ) : null}
          </View>
          {!titleOnArt ? (
            <>
              <Text
                style={[s.title, circle && s.center, scriptStyle(titleText, circle ? s.center : s.title)]}
                numberOfLines={lines}>
                {titleText}
              </Text>
              {sub ? (
                <Text style={[s.meta, circle && s.center, scriptStyle(sub, circle ? s.center : s.meta)]} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Touchable>
  );
});

function Progress({ fraction, inline }: { fraction: number; inline?: boolean }) {
  const s = useStyles(makeStyles);
  return (
    <View style={inline ? s.progressInline : s.progress}>
      <View style={[s.progressFill, { width: `${Math.max(2, Math.round(fraction * 100))}%` }]} />
    </View>
  );
}

export function tileAspect(shape: TileShape): number {
  return SHAPES[shape].aspect;
}

/** Height of a tile with its text, for skeletons and fixed row heights. */
export function tileHeight(shape: TileShape, width: number, withText = true): number {
  const art = width / SHAPES[shape].aspect;
  if (!withText) return art;
  return art + sizes.tileTitleGap + scaled(type.tileTitle.lineHeight) + sizes.tileMetaGap + scaled(type.caption1.lineHeight);
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  title: { ...font(type.tileTitle), color: c.text, marginTop: scaled(sizes.tileTitleGap) },
  meta: { ...font(type.caption1), color: c.text2, marginTop: sizes.tileMetaGap },
  center: { textAlign: 'center' as const },
  artText: { overflow: 'hidden' as const, justifyContent: 'flex-end' as const, padding: scaled(sizes.progressInset) },
  onArtTitle: { ...font(type.tileTitle), fontSize: scaled(15), color: c.textOnMedia },
  onArtMeta: { ...font(type.caption1), color: c.textOnMediaSecondary, marginTop: sizes.tileMetaGap },
  progress: {
    position: 'absolute' as const,
    left: scaled(sizes.progressInset),
    right: scaled(sizes.progressInset),
    bottom: scaled(sizes.progressInset),
    height: scaled(sizes.progress),
    borderRadius: radius.pill,
    backgroundColor: c.progressTrack,
    overflow: 'hidden' as const,
  },
  progressInline: {
    marginTop: scaled(8),
    height: scaled(sizes.progress),
    borderRadius: radius.pill,
    backgroundColor: c.progressTrack,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, backgroundColor: mediaColors.white, borderRadius: radius.pill },
  badge: {
    position: 'absolute' as const,
    top: sizes.badgeInset,
    right: sizes.badgeInset,
    minWidth: scaled(sizes.badge),
    height: scaled(sizes.badge),
    borderRadius: radius.pill,
    backgroundColor: mediaColors.badgeFill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countBadge: { paddingHorizontal: 6 },
  count: { ...font(type.caption2, { tabular: true }), color: mediaColors.white },
}));
