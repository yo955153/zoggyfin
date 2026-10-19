import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { ItemActionSheet } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { useItemActions } from '@/features/actions/use-item-actions';
import { usePlayer } from '@/player';
import { colors, GUTTER, iconSize, radius, shadow, size, spacing, type } from '@/theme';

import { useIsWide } from './use-wide';

export type ArtShape = 'poster' | 'square' | 'circle' | 'landscape';

interface DetailScaffoldProps<Row> {
  item: BaseItemDto;
  art: ArtShape;
  /** Short facts under the title: year, runtime, rating. */
  meta: (string | null | undefined)[];
  /** A line above the title, for example the series name of an episode. */
  eyebrow?: string | null;
  playable?: boolean;
  playLabel?: string;
  rows?: Row[];
  renderRow?: (row: Row, index: number) => ReactElement;
  rowKey?: (row: Row, index: number) => string;
  /** Shown between the header and the rows. */
  beforeRows?: ReactNode;
  /** Shown after the rows: cast, similar items. */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}

/**
 * The shared item page: a backdrop, the artwork, title, facts, actions and
 * overview, then a FlashList of rows (tracks, episodes). Wide windows put the
 * artwork and facts in a left column beside the content.
 */
export function DetailScaffold<Row>({
  item,
  art,
  meta,
  eyebrow,
  playable,
  playLabel = 'Play',
  rows,
  renderRow,
  rowKey,
  beforeRows,
  footer,
  refreshing,
  onRefresh,
}: DetailScaffoldProps<Row>) {
  const { width } = useWindowDimensions();
  const wide = useIsWide();
  const player = usePlayer();
  const { actions, run } = useItemActions(item);
  const [sheet, setSheet] = useState(false);
  const favorite = !!item.UserData?.IsFavorite;
  // Resume / Start over: only for a single video with a saved position.
  const resumable = !!item.UserData?.PlaybackPositionTicks && ['Movie', 'Episode', 'Video', 'MusicVideo'].includes(item.Type ?? '');
  const favAction = actions.find((a) => a.id === (favorite ? 'builtin.unfavorite' : 'builtin.favorite'));

  const heroHeight = wide ? Math.min(360, width * 0.3) : Math.min(width * 0.62, 340);
  const artWidth = wide ? 260 : art === 'poster' ? 150 : art === 'landscape' ? Math.min(width - GUTTER * 2, 360) : 180;
  const artAspect = art === 'poster' ? 2 / 3 : art === 'landscape' ? 16 / 9 : 1;
  const contentWidth = Math.min(width, size.contentMaxWidth);

  const facts = meta.filter((m): m is string => !!m);

  const titleBlock = (
    <View style={[styles.titleBlock, !wide && styles.center]}>
      {eyebrow ? <Text style={[styles.eyebrow, !wide && styles.textCenter]}>{eyebrow}</Text> : null}
      <Text style={[styles.title, !wide && styles.textCenter]} accessibilityRole="header">
        {item.Name}
      </Text>
      {facts.length ? <Text style={[styles.meta, !wide && styles.textCenter]}>{facts.join('  ·  ')}</Text> : null}
      <View style={[styles.buttons, !wide && styles.buttonsNarrow]}>
        {playable ? (
          <Button
            title={playLabel}
            icon="play.fill"
            onPress={() => player.play({ item })}
            style={wide ? styles.playWide : styles.playNarrow}
          />
        ) : null}
        {playable && resumable ? (
          <IconButton icon="arrow.counterclockwise" label="Start over" onPress={() => player.play({ item, startPositionTicks: 0 })} />
        ) : null}
        {favAction ? (
          <IconButton
            icon={favorite ? 'heart.fill' : 'heart'}
            label={favAction.title}
            active={favorite}
            onPress={() => run(favAction)}
          />
        ) : null}
        <IconButton icon="ellipsis" label="More actions" onPress={() => setSheet(true)} />
      </View>
      {item.Overview ? <Overview text={item.Overview} centered={!wide} /> : null}
      {item.Genres?.length ? (
        <Text style={[styles.genres, !wide && styles.textCenter]}>{item.Genres.join(', ')}</Text>
      ) : null}
    </View>
  );

  const header = (
    <View>
      <View style={{ height: heroHeight }}>
        <ItemImage item={item} variant="backdrop" width={width} aspectRatio={width / heroHeight} rounded={0} hideArtTitle />
        <LinearGradient
          colors={colors.heroFade}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={[styles.body, { width: contentWidth, alignSelf: 'center' }, wide ? styles.bodyWide : null]}>
        <View style={[!wide && styles.center, { marginTop: -heroHeight * (wide ? 0.55 : 0.45) }]}>
          <ItemImage item={item} variant={art === 'landscape' ? 'landscape' : art === 'poster' ? 'poster' : 'square'} width={artWidth} aspectRatio={artAspect} rounded={radius.lg} circle={art === 'circle'} style={styles.artShadow} />
        </View>
        {titleBlock}
      </View>
      {beforeRows ? <View style={{ width: contentWidth, alignSelf: 'center' }}>{beforeRows}</View> : null}
    </View>
  );

  return (
    <>
      <FlashList
        data={rows ?? []}
        keyExtractor={rowKey ?? ((_, i) => String(i))}
        renderItem={({ item: row, index }) => (
          <View style={{ width: contentWidth, alignSelf: 'center' }}>{renderRow ? renderRow(row, index) : null}</View>
        )}
        ListHeaderComponent={header}
        ListFooterComponent={<View style={[styles.footer, { width: contentWidth, alignSelf: 'center' }]}>{footer}</View>}
        contentInsetAdjustmentBehavior="never"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} /> : undefined}
      />
      <ItemActionSheet item={item} visible={sheet} onClose={() => setSheet(false)} />
    </>
  );
}

function IconButton({ icon, label, onPress, active }: { icon: string; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.iconButton,
        (pressed || hovered) && { opacity: 0.75 },
      ]}>
      <Icon name={icon} size={iconSize.xl} color={active ? colors.accent : colors.text} />
    </Pressable>
  );
}

function Overview({ text, centered }: { text: string; centered: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityHint="Shows the full text">
      <Text style={[styles.overview, centered && styles.textCenter]} numberOfLines={open ? undefined : 4}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: GUTTER, gap: spacing.lg },
  bodyWide: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxl },
  center: { alignItems: 'center' },
  textCenter: { textAlign: 'center' },
  artShadow: shadow.art,
  titleBlock: { flex: 1, gap: spacing.sm, width: '100%' },
  eyebrow: { ...type.eyebrow, color: colors.textSecondary },
  title: { ...type.title, color: colors.text },
  meta: { ...type.callout, color: colors.textSecondary },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  buttonsNarrow: { justifyContent: 'center' },
  playWide: { minWidth: 160 },
  playNarrow: { flex: 1, maxWidth: size.playButtonMaxWidth },
  iconButton: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overview: { ...type.body, color: colors.text, marginTop: spacing.sm, opacity: 0.9 },
  genres: { ...type.callout, color: colors.textTertiary },
  footer: { paddingBottom: spacing.xxl * 2 },
});
