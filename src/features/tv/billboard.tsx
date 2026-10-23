/**
 * TV Home billboard: the focused item, large, at the top of the screen (like
 * the streaming apps on TV). Tiles in the Home rows report their focus here;
 * the billboard follows after a short pause, so a fast move along a row does
 * not load every backdrop.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { create } from 'zustand';

import { useItem, useResume } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { useImageServer } from '@/api/use-api';
import { ItemImage } from '@/components/item-image';
import { buildImageUrl, imageSource } from '@/images/image-url';
import { resolveImage } from '@/images/resolve-image';
import { episodeLabel, formatDuration } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import {
  type AppTheme,
  createStyles,
  font,
  motion,
  scaled,
  scriptStyle,
  sizes,
  spacing,
  tv,
  type,
  useLayout,
  useStyles,
  useTheme,
  withAlpha,
} from '@/theme';

interface BillboardState {
  item: BaseItemDto | null;
}

const useBillboardStore = create<BillboardState>(() => ({ item: null }));

/** A Home tile took the focus: show its item on the billboard. */
export function showOnBillboard(item: BaseItemDto): void {
  if (useBillboardStore.getState().item?.Id !== item.Id) useBillboardStore.setState({ item });
}

/** The pause before the billboard follows the focus (ms). */
const FOLLOW_MS = 350;

/** The billboard height for a window height. */
export function billboardHeight(windowHeight: number): number {
  return Math.round(windowHeight * tv.billboardFactor);
}

/** The metadata line: year, rating, length, genres (an episode: its number and name). */
function metaLine(item: BaseItemDto): string {
  if (item.Type === 'Episode') return [episodeLabel(item), item.Name].filter(Boolean).join(' · ');
  const parts = [
    item.ProductionYear ? String(item.ProductionYear) : null,
    item.OfficialRating ?? null,
    item.Type === 'Series' ? null : formatDuration(item.RunTimeTicks),
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null,
    item.Genres?.slice(0, 3).join(', ') || null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function Billboard() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const focused = useBillboardStore((st) => st.item);
  // Before any tile has the focus: the first item to continue.
  const first = useResume('Video').data?.[0] ?? null;
  const shown = useDebounced(focused ?? first, FOLLOW_MS);
  // The tiles carry no overview: the full item fills it in.
  const full = useItem(shown?.Id ?? undefined);
  const item = full.data?.Id === shown?.Id ? (full.data ?? shown) : shown;
  const height = billboardHeight(l.height);
  const width = l.contentWidth;
  const artW = Math.round(width * 0.72);
  const server = useImageServer();
  // One backdrop at the size it shows (capped), so a focus move loads a small image.
  const scale = Math.min(PixelRatio.get(), 1.5);
  const art = item ? resolveImage(item, 'backdrop', { width: Math.round(artW * scale), height: Math.round(height * scale) }, server) : null;

  if (!item) return <View style={{ height }} />;
  const title = (item.Type === 'Episode' ? item.SeriesName : null) ?? item.Name ?? '';
  const meta = metaLine(item);
  return (
    <View style={[s.root, { height }]} accessibilityLiveRegion="polite">
      {/* No key: the old backdrop stays until the new one has loaded, then cross-fades. */}
      <View style={[s.art, { width: artW, height }]}>
        {art?.kind === 'remote' ? (
          <Image
            source={imageSource(art.uri, server)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={motion.duration.base}
            cachePolicy="memory-disk"
            priority="high"
          />
        ) : (
          <ItemImage item={item} variant="backdrop" width={artW} aspectRatio={artW / height} rounded={0} hideArtTitle hairline={false} />
        )}
      </View>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* The art fades into the page on the left and at the bottom. */}
        <LinearGradient
          colors={[c.bg, withAlpha(c.bg, 0.85), withAlpha(c.bg, 0)]}
          locations={[0.28, 0.45, 0.75]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[withAlpha(c.bg, 0), c.bg]}
          locations={[0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <Animated.View key={item.Id} entering={FadeIn.duration(motion.duration.fast)} style={[s.text, { left: l.gutter, width: width * 0.46, bottom: spacing.md }]}>
        <Title item={item} title={title} />
        {meta ? (
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {item.Overview ? (
          <Text style={[s.overview, scriptStyle(item.Overview, s.overview, true)]} numberOfLines={2}>
            {item.Overview}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** The server logo when there is one, else the title as text. */
function Title({ item, title }: { item: BaseItemDto; title: string }) {
  const s = useStyles(makeStyles);
  const server = useImageServer();
  const [failed, setFailed] = useState<string | null>(null);
  const logo = item.ImageTags?.Logo
    ? { id: item.Id ?? '', tag: item.ImageTags.Logo }
    : item.ParentLogoItemId && item.ParentLogoImageTag
      ? { id: item.ParentLogoItemId, tag: item.ParentLogoImageTag }
      : null;
  const uri =
    logo && server
      ? buildImageUrl(server, { itemId: logo.id, type: 'Logo', tag: logo.tag, width: scaled(sizes.logoMaxWidth) * PixelRatio.get() })
      : null;
  if (uri && failed !== uri) {
    return (
      <View style={s.logoBox} accessible accessibilityRole="header" accessibilityLabel={title}>
        <Image source={imageSource(uri, server)} style={s.logo} contentFit="contain" contentPosition="left" onError={() => setFailed(uri)} />
      </View>
    );
  }
  return (
    <Text style={[s.title, scriptStyle(title, s.title, true)]} numberOfLines={2} accessibilityRole="header">
      {title}
    </Text>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  root: { overflow: 'hidden' as const },
  art: { position: 'absolute' as const, top: 0, right: 0 },
  text: { position: 'absolute' as const, gap: spacing.xs },
  title: { ...font(type.title1), color: c.text },
  logoBox: { width: scaled(sizes.logoMaxWidth), height: scaled(sizes.logoMaxHeight * 0.8) },
  logo: { width: '100%' as const, height: '100%' as const },
  meta: { ...font(type.headline), color: c.text2 },
  overview: { ...font(type.callout), color: c.text },
}));

/** True inside the TV Home rows: their tiles show only art and report focus to the billboard. */
export const BillboardRows = createContext(false);
