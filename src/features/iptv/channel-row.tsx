/**
 * A channel in the Live TV list: logo, number and name, the programme now
 * with its progress, and the one after. The heart is its own button, so on
 * TV it is reached with Right from the row (every remote has Right); the
 * menu key on the focused row and a long press on touch also favourite it.
 * Fixed height, so the list can jump to any row (`getItemLayout`).
 */
import { memo } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { type Channel, progressOf, useNowNext } from '@/iptv';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { ChannelLogo } from './channel-logo';

/** The row height (TV rows are scaled with the type). */
export const CHANNEL_ROW_HEIGHT = scaled(72);

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const ChannelRow = memo(function ChannelRow({
  providerId,
  channel,
  favourite,
  playing,
  now,
  preferredFocus,
  onPlay,
  onToggleFavourite,
  onFocusRow,
}: {
  providerId: string;
  channel: Channel;
  favourite: boolean;
  /** This channel plays now. */
  playing: boolean;
  /** The time to show now and next for (to the minute). */
  now: number;
  preferredFocus?: boolean;
  onPlay: (channel: Channel) => void;
  onToggleFavourite: (channel: Channel) => void;
  onFocusRow?: (channel: Channel | null) => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const nn = useNowNext(providerId, channel, now);
  const title = channel.number !== undefined ? `${channel.number}  ${channel.name}` : channel.name;
  const nowText = nn.now ? nn.now.title : null;
  const nextText = nn.next ? `${clock(nn.next.start)} ${nn.next.title}` : null;
  const label = [title, nowText ? `Now: ${nowText}` : null, nn.next ? `Next at ${clock(nn.next.start)}: ${nn.next.title}` : null, favourite ? 'Favourite' : null]
    .filter(Boolean)
    .join('. ');
  return (
    <View style={s.wrap}>
      <Touchable
        kind="row"
        containerStyle={s.flex}
        onPress={() => onPlay(channel)}
        onLongPress={() => onToggleFavourite(channel)}
        delayLongPress={450}
        hasTVPreferredFocus={preferredFocus}
        onFocus={() => onFocusRow?.(channel)}
        onBlur={() => onFocusRow?.(null)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={isTV ? undefined : 'Plays the channel. Long press to add it to Favourites or remove it.'}
        radius={radius.md}
        style={({ pressed, hovered }) => [s.row, (pressed || hovered) && s.rowPressed]}>
        {() => (
          <>
            <ChannelLogo uri={channel.logo} name={channel.name} size={scaled(40)} />
            <View style={s.body}>
              <View style={s.titleLine}>
                {playing ? <Icon name="play.fill" size={scaled(iconSize.sm - 4)} color={c.accent} /> : null}
                <Text style={[s.title]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              {nowText ? (
                <View style={s.nowLine}>
                  <Text style={[s.now]} numberOfLines={1}>
                    {nowText}
                  </Text>
                  {nn.now ? (
                    <View style={s.track}>
                      <View style={[s.fill, { width: `${Math.round(progressOf(nn.now, now) * 100)}%` }]} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <Text style={[s.now, s.muted]} numberOfLines={1}>
                  {channel.group || 'Live'}
                </Text>
              )}
              {nextText && !isTV ? (
                <Text style={[s.next]} numberOfLines={1}>
                  {nextText}
                </Text>
              ) : null}
            </View>
          </>
        )}
      </Touchable>
      <Touchable
        kind="icon"
        radius={radius.pill}
        onPress={() => onToggleFavourite(channel)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={favourite ? `Remove ${channel.name} from Favourites` : `Add ${channel.name} to Favourites`}
        accessibilityState={{ selected: favourite }}
        style={s.heart}>
        <Icon name={favourite ? 'heart.fill' : 'heart'} size={scaled(iconSize.sm)} color={favourite ? c.accent : c.text3} />
      </Touchable>
    </View>
  );
});

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { flexDirection: 'row' as const, alignItems: 'center' as const, height: CHANNEL_ROW_HEIGHT, gap: spacing.xs },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    height: CHANNEL_ROW_HEIGHT - spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderCurve: 'continuous' as const,
  },
  rowPressed: { backgroundColor: c.surface2 },
  body: { flex: 1, minWidth: 0, gap: sizes.tileMetaGap },
  titleLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  title: { ...font(type.headline), color: c.text, flexShrink: 1 },
  nowLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  now: { ...font(type.subheadline), color: c.text2, flexShrink: 1 },
  muted: { color: c.text3 },
  next: { ...font(type.caption1), color: c.text3 },
  track: { width: scaled(36), height: sizes.resumeBar, borderRadius: sizes.resumeBar, backgroundColor: c.surface3, overflow: 'hidden' as const },
  fill: { height: sizes.resumeBar, backgroundColor: c.accent },
  heart: { width: scaled(sizes.iconButton), height: scaled(sizes.iconButton), alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: radius.pill },
}));
