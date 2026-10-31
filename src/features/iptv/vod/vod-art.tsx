/**
 * The poster or still of an IPTV film, series or episode. Provider images
 * are plain http(s) URLs on other hosts: they load with no Jellyfin token
 * (never through `ItemImage`, which adds one). Generated art (§7.5) shows
 * when there is no image or it does not load, like on server items.
 */
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GeneratedArtView } from '@/components/item-image';
import { generatedArt } from '@/images/generated-art';
import { createStyles, type AppTheme, mediaColors, motion, radius, useStyles } from '@/theme';

export const VodArt = memo(function VodArt({
  uri,
  name,
  id,
  kind,
  width,
  aspectRatio,
  rounded = radius.md,
  showTitle = true,
}: {
  uri: string | null | undefined;
  name: string;
  /** Seeds the generated art. */
  id: string;
  kind: 'film' | 'series' | 'episode';
  width: number;
  aspectRatio: number;
  rounded?: number;
  showTitle?: boolean;
}) {
  const s = useStyles(makeStyles);
  const [failed, setFailed] = useState<string | null>(null);
  const height = width / aspectRatio;
  const box = { width, height, borderRadius: rounded, borderCurve: 'continuous' as const };
  const show = !!uri && /^https?:\/\//i.test(uri) && failed !== uri;
  return (
    <View style={[s.box, box]} accessibilityIgnoresInvertColors>
      {show ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          transition={motion.duration.fast}
          recyclingKey={uri}
          cachePolicy="memory-disk"
          onError={() => setFailed(uri)}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <GeneratedArtView
          art={generatedArt(name, kind === 'film' ? 'Movie' : kind === 'series' ? 'Series' : 'Episode', null, id)}
          width={width}
          height={height}
          circle={false}
          showTitle={showTitle}
          showIcon
          name={name}
        />
      )}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.hairline, { borderRadius: rounded }]} />
    </View>
  );
});

const makeStyles = createStyles(({ c, scheme }: AppTheme) => ({
  box: { overflow: 'hidden' as const, backgroundColor: c.surface2 },
  hairline: { borderWidth: 0.5, borderColor: scheme === 'light' ? mediaColors.tileHairlineLight : mediaColors.tileHairlineDark },
}));
