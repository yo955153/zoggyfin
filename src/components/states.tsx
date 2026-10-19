import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { describeError } from '@/api/errors';
import { Icon, type IconName } from '@/components/icon';
import { createStyles, type AppTheme, font, iconSize, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { Button } from './button';
import { Delayed, SkeletonBlock, SkeletonText } from './skeleton';
import { SHAPES, type TileShape } from './tile-shape';
import { gridLayout } from '@/theme/layout';
import { isTV } from '@/platform/tv';

function errorIcon(kind: string): IconName {
  return kind === 'network' || kind === 'timeout' || kind === 'offline' ? 'wifi.exclamationmark' : 'exclamationmark.triangle';
}

/**
 * A failed request (design system §7.13). Whole screen: icon, a plain title,
 * the reason and a Retry button. `compact` is the inline row version.
 */
export function ErrorState({
  error,
  onRetry,
  compact,
  style,
}: {
  error: unknown;
  onRetry: () => void;
  compact?: boolean;
  style?: ViewStyle;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const d = describeError(error);
  if (compact) {
    return (
      <View style={[s.compact, style]} accessibilityRole="alert">
        <Icon name={errorIcon(d.kind)} size={scaled(iconSize.sm)} color={c.danger} />
        <Text style={s.compactText} numberOfLines={2}>
          {d.title}. {d.message}
        </Text>
        <Button title="Retry" variant="text" onPress={onRetry} />
      </View>
    );
  }
  return (
    <View style={[s.center, style]} accessibilityRole="alert">
      <Icon name={errorIcon(d.kind)} size={scaled(sizes.stateIcon)} color={c.text3} />
      <Text style={s.title}>{d.title}</Text>
      <Text style={s.message}>{d.message}</Text>
      <Button title="Retry" icon="arrow.clockwise" onPress={onRetry} containerStyle={s.action} preferredFocus={isTV} />
    </View>
  );
}

/** Nothing to show: icon, title, one sentence and at most one tonal action. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  style,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: { title: string; onPress: () => void };
  style?: ViewStyle;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={[s.center, style]}>
      <Icon name={icon} size={scaled(sizes.stateIcon)} color={c.text3} />
      <Text style={s.title}>{title}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      {action ? <Button title={action.title} variant="tonal" onPress={action.onPress} containerStyle={s.action} /> : null}
    </View>
  );
}

/** Loading a list: skeleton rows in the real layout. */
export function LoadingState({ style, rows = 6 }: { style?: ViewStyle; rows?: number }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  return (
    <Delayed>
      <View style={[s.list, { paddingHorizontal: l.gutter }, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={s.listRow}>
            <SkeletonBlock width={scaled(sizes.trackArt)} height={scaled(sizes.trackArt)} radius={6} />
            <View style={s.flex}>
              <SkeletonBlock width="60%" height={sizes.skeletonBar} radius={6} />
              <SkeletonBlock width="40%" height={sizes.skeletonBar} radius={6} style={s.gapTop} />
            </View>
          </View>
        ))}
      </View>
    </Delayed>
  );
}

/** Loading an item page: the hero, the title, the metadata line and the Play button. */
export function DetailSkeleton() {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const hero = Math.round(Math.min(l.width * (9 / 16), 420));
  return (
    <Delayed>
      <View accessibilityLabel="Loading" accessibilityRole="progressbar">
        <SkeletonBlock width={l.width} height={hero} />
        <View style={[s.detail, { paddingHorizontal: l.gutter }]}>
          <SkeletonBlock width="70%" height={scaled(28)} radius={8} style={s.selfCenter} />
          <SkeletonBlock width="45%" height={sizes.skeletonBar} radius={6} style={s.selfCenter} />
          <SkeletonBlock width="100%" height={scaled(sizes.buttonHeight)} radius={14} />
          <SkeletonBlock width="100%" height={sizes.skeletonBar} radius={6} />
          <SkeletonBlock width="80%" height={sizes.skeletonBar} radius={6} />
        </View>
      </View>
    </Delayed>
  );
}

/** Loading a grid: skeleton tiles at the real grid sizes. */
export function GridSkeleton({ shape, width }: { shape: TileShape; width?: number }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const g = gridLayout(shape === 'thumb' ? 'thumb' : shape, width ?? l.contentWidth, l.tv, l.width);
  const h = g.tileWidth / SHAPES[shape].aspect;
  return (
    <Delayed>
      <View style={[s.grid, { paddingHorizontal: g.gutter, gap: g.gap }]} accessibilityLabel="Loading" accessibilityRole="progressbar">
        {Array.from({ length: g.columns * 3 }, (_, i) => (
          <View key={i} style={{ width: g.tileWidth }}>
            <SkeletonBlock width={g.tileWidth} height={h} radius={shape === 'circle' ? g.tileWidth / 2 : shape === 'square' ? 8 : 10} />
            <SkeletonText width={g.tileWidth} />
          </View>
        ))}
      </View>
    </Delayed>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: spacing.xxl,
    gap: spacing.sm,
    minHeight: 260,
  },
  title: { ...font(type.headline), color: c.text, textAlign: 'center' as const, marginTop: spacing.md },
  message: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(sizes.stateMessageMaxWidth) },
  action: { marginTop: spacing.lg, minWidth: 160 },
  compact: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingLeft: 14,
    marginHorizontal: spacing.lg,
    borderRadius: 14,
    backgroundColor: c.surface,
    minHeight: sizes.rowMin,
  },
  compactText: { ...font(type.footnote), color: c.text2, flex: 1 },
  list: { paddingTop: spacing.lg, gap: spacing.md },
  listRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  gapTop: { marginTop: 8 },
  detail: { gap: spacing.lg, marginTop: spacing.xl },
  selfCenter: { alignSelf: 'center' as const },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, paddingTop: spacing.lg, rowGap: 20 },
}));

export const stateStyles = StyleSheet.create({ fill: { flex: 1 } });
