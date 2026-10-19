import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BaseItemDto, BaseItemPerson } from '@/api/types';
import { ItemImage } from '@/components/item-image';
import { episodeLabel, formatClock, formatDuration, playedFraction } from '@/lib/format';
import { colors, GUTTER, radius, size, spacing, type } from '@/theme';

type HoverState = { pressed: boolean; hovered?: boolean };
const active = ({ pressed, hovered }: HoverState) => (pressed || hovered ? { backgroundColor: colors.pressedRow } : null);

/** A song row: number, title, artist, length. */
export const TrackRow = memo(function TrackRow({
  item,
  index,
  showArt,
  onPress,
}: {
  item: BaseItemDto;
  index: number;
  showArt?: boolean;
  onPress: (item: BaseItemDto) => void;
}) {
  const artist = item.Artists?.join(', ') ?? item.AlbumArtist;
  return (
    <Pressable onPress={() => onPress(item)} style={(s: HoverState) => [styles.track, active(s)]} accessibilityRole="button" accessibilityLabel={[item.Name, artist].filter(Boolean).join(', ')}>
      {showArt ? (
        <ItemImage item={item} variant="square" width={44} aspectRatio={1} rounded={radius.sm} hideArtTitle />
      ) : (
        <Text style={styles.trackNo}>{item.IndexNumber ?? index + 1}</Text>
      )}
      <View style={styles.flex}>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {item.Name}
        </Text>
        {artist ? (
          <Text style={styles.trackSub} numberOfLines={1}>
            {artist}
          </Text>
        ) : null}
      </View>
      <Text style={styles.trackTime}>{formatClock(item.RunTimeTicks) ?? ''}</Text>
    </Pressable>
  );
});

/** An episode row: still, number and title, runtime, overview. */
export const EpisodeRow = memo(function EpisodeRow({ item, onPress }: { item: BaseItemDto; onPress: (item: BaseItemDto) => void }) {
  const progress = playedFraction(item);
  return (
    <Pressable onPress={() => onPress(item)} style={(s: HoverState) => [styles.episode, active(s)]} accessibilityRole="button">
      <View>
        <ItemImage item={item} variant="landscape" width={150} aspectRatio={16 / 9} rounded={radius.sm} hideArtTitle />
        {progress !== null ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.flex}>
        <Text style={styles.epLabel}>
          {[episodeLabel(item), formatDuration(item.RunTimeTicks), item.UserData?.Played ? 'Watched' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text style={styles.epTitle} numberOfLines={2}>
          {item.Name}
        </Text>
        {item.Overview ? (
          <Text style={styles.epOverview} numberOfLines={2}>
            {item.Overview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/** Cast and crew entries as items, so they use the same tiles and image rules. */
export function personToItem(p: BaseItemPerson): BaseItemDto {
  return {
    Id: p.Id,
    Name: p.Name,
    Type: 'Person',
    ImageTags: p.PrimaryImageTag ? { Primary: p.PrimaryImageTag } : {},
    ImageBlurHashes: p.ImageBlurHashes,
    Overview: p.Role ?? p.Type ?? undefined,
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  track: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: GUTTER, paddingVertical: spacing.sm2, minHeight: size.trackRowHeight },
  trackNo: { ...type.callout, ...type.number, color: colors.textTertiary, width: size.trackNumber, textAlign: 'center' },
  trackTitle: { ...type.body, color: colors.text },
  trackSub: { ...type.callout, color: colors.textSecondary },
  trackTime: { ...type.callout, ...type.number, color: colors.textTertiary },
  episode: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: GUTTER, paddingVertical: spacing.md },
  epLabel: { ...type.caption, color: colors.textSecondary },
  epTitle: { ...type.bodyStrong, color: colors.text, marginTop: spacing.xxs },
  epOverview: { ...type.callout, color: colors.textSecondary, marginTop: spacing.xs },
  progressTrack: { position: 'absolute', left: size.badgeInset, right: size.badgeInset, bottom: size.badgeInset, height: size.progressBarThin, borderRadius: radius.bar, backgroundColor: colors.progressTrack, overflow: 'hidden' },
  progressFill: { height: size.progressBarThin, backgroundColor: colors.progress },
});
