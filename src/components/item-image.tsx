import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useImageServer } from '@/api/use-api';
import type { BaseItemDto } from '@/api/types';
import { generatedArt } from '@/images/generated-art';
import { type ImageVariant, type ResolvedImage, resolveImage } from '@/images/resolve-image';
import { Icon } from '@/components/icon';
import { colors, motion, radius, spacing, type } from '@/theme';

export interface ItemImageProps {
  item: BaseItemDto;
  variant: ImageVariant;
  /** Width in points. */
  width: number;
  /** Width / height. */
  aspectRatio: number;
  rounded?: number;
  /** Hide the title on generated art (when the title is already shown next to the image). */
  hideArtTitle?: boolean;
  style?: ViewStyle;
  /** A circle, for people and artists. */
  circle?: boolean;
}

/**
 * The one image component for items. It always shows something: a server
 * image with a BlurHash while it loads, or generated art when there is no
 * image or the image fails to load.
 */
export const ItemImage = memo(function ItemImage({
  item,
  variant,
  width,
  aspectRatio,
  rounded = radius.md,
  hideArtTitle,
  style,
  circle,
}: ItemImageProps) {
  const server = useImageServer();
  const height = width / aspectRatio;
  const scale = PixelRatio.get();
  const resolved = useMemo(
    () => resolveImage(item, variant, { width: width * scale, height: height * scale }, server),
    [item, variant, width, height, scale, server],
  );
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const borderRadius = circle ? width / 2 : rounded;
  const box: ViewStyle = { width, height, borderRadius, overflow: 'hidden', backgroundColor: colors.surface };

  const shown: ResolvedImage =
    resolved.kind === 'remote' && resolved.uri === failedUri
      ? { kind: 'generated', ...generatedArt(item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name, item.Type, item.CollectionType) }
      : resolved;

  if (shown.kind === 'generated') {
    return (
      <View style={[box, style]} accessibilityIgnoresInvertColors>
        <GeneratedArtView art={shown} width={width} height={height} showTitle={!hideArtTitle} showIcon={variant !== 'backdrop'} />
      </View>
    );
  }

  const crop = shown.crop;
  return (
    <View style={[box, style]} accessibilityIgnoresInvertColors>
      <Image
        source={{ uri: shown.uri }}
        placeholder={shown.blurhash ? { blurhash: shown.blurhash } : undefined}
        placeholderContentFit="cover"
        contentFit="cover"
        transition={motion.imageFade}
        recyclingKey={shown.uri}
        cachePolicy="memory-disk"
        onError={() => setFailedUri(shown.uri)}
        style={
          crop
            ? { width: width * crop.columns, height: height * crop.rows, position: 'absolute', left: 0, top: 0 }
            : StyleSheet.absoluteFill
        }
      />
    </View>
  );
});

function GeneratedArtView({
  art,
  width,
  height,
  showTitle,
  showIcon,
}: {
  art: { colors: [string, string]; icon: string; title: string };
  width: number;
  height: number;
  showTitle: boolean;
  showIcon: boolean;
}) {
  const small = Math.min(width, height);
  const iconSize = Math.max(16, Math.min(44, small * 0.28));
  const showText = showTitle && small >= 70;
  return (
    <LinearGradient colors={art.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.art}>
      {showIcon ? <Icon name={art.icon} size={iconSize} color={colors.artIcon} /> : null}
      {showText ? (
        <Text style={[styles.artTitle, small > 140 ? type.artTitleLarge : type.artTitleSmall]} numberOfLines={3}>
          {art.title}
        </Text>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  art: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm2,
    gap: spacing.sm,
  },
  artTitle: {
    ...type.artTitle,
    color: colors.artText,
    textAlign: 'center',
  },
});
