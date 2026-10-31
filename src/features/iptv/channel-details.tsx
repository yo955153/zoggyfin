/**
 * TV: the focused channel beside the channel list (TiviMate style): the
 * logo, number, name and group, what runs now with its times, a progress bar
 * and the time left, and what comes next. It follows the focus, so the list
 * rows can stay short. A hint at the bottom names the two remote keys.
 */
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { type Channel, iptv, progressOf, useNowNext } from '@/iptv';
import { clock, timeLeft, timeRange } from '@/lib/programme-time';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { ChannelLogo } from './channel-logo';

export function ChannelDetails({
  providerId,
  channel,
  providerLabel,
  now,
  favourite,
  width,
}: {
  providerId: string;
  channel: Channel | null;
  /** The provider's name, in "All providers". */
  providerLabel?: string;
  now: number;
  favourite: boolean;
  width: number;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const nn = useNowNext(providerId, channel, now);
  // Xtream: the guide of the focused channel loads on demand.
  useEffect(() => {
    if (channel) iptv.requestNowNext(providerId, [channel]);
  }, [providerId, channel]);

  if (!channel) {
    return (
      <View style={[s.panel, s.centred, { width }]}>
        <Icon name="tv" size={scaled(sizes.stateIcon)} color={c.text3} />
        <Text style={s.hintCentred}>Move to a channel to see what is on.</Text>
      </View>
    );
  }
  return (
    <View style={[s.panel, { width }]} accessibilityLiveRegion="polite">
      <ChannelLogo uri={channel.logo} name={channel.name} size={scaled(60)} />
      <View style={s.nameBlock}>
        <Text style={s.name} numberOfLines={2}>
          {channel.number !== undefined ? <Text style={s.number}>{channel.number}  </Text> : null}
          {channel.name}
        </Text>
        <View style={s.groupLine}>
          {favourite ? <Icon name="heart.fill" size={scaled(iconSize.sm - 6)} color={c.accent} /> : null}
          <Text style={s.group} numberOfLines={1}>
            {[favourite ? 'Favourite' : null, providerLabel ?? null, channel.group || null].filter(Boolean).join(' · ') || 'Live'}
          </Text>
        </View>
      </View>

      {nn.now ? (
        <View style={s.block}>
          <Text style={s.label}>
            NOW <Text style={s.time}> {timeRange(nn.now.start, nn.now.stop)}</Text>
          </Text>
          <Text style={s.title} numberOfLines={2}>
            {nn.now.title}
          </Text>
          <View style={s.progressLine}>
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.round(progressOf(nn.now, now) * 100)}%` }]} />
            </View>
            <Text style={s.left}>{timeLeft(nn.now.stop, now)}</Text>
          </View>
          {nn.now.description ? (
            <Text style={s.description} numberOfLines={3}>
              {nn.now.description}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={s.block}>
          <Text style={s.label}>NOW</Text>
          <Text style={s.noGuide}>No guide for this channel.</Text>
        </View>
      )}

      {nn.next ? (
        <View style={s.block}>
          <Text style={s.label}>
            NEXT <Text style={s.time}> {clock(nn.next.start)}</Text>
          </Text>
          <Text style={s.nextTitle} numberOfLines={2}>
            {nn.next.title}
          </Text>
        </View>
      ) : null}

      <View style={s.spacer} />
      <Text style={s.hint}>Select to watch. The menu key adds it to Favourites or removes it.</Text>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  panel: {
    alignSelf: 'stretch' as const,
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: c.surface,
    borderCurve: 'continuous' as const,
  },
  centred: { alignItems: 'center' as const, justifyContent: 'center' as const },
  hintCentred: { ...font(type.subheadline), color: c.text3, textAlign: 'center' as const },
  nameBlock: { gap: spacing.xxs },
  name: { ...font(type.title3), color: c.text },
  number: { color: c.text2, fontVariant: ['tabular-nums' as const] },
  groupLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  group: { ...font(type.footnote), color: c.text2, flexShrink: 1 },
  block: { gap: spacing.xs },
  label: { ...font(type.caption1), fontWeight: '700' as const, letterSpacing: 0.6, color: c.accent },
  time: { ...font(type.caption1), fontWeight: '500' as const, letterSpacing: 0, color: c.text2, fontVariant: ['tabular-nums' as const] },
  title: { ...font(type.headline), color: c.text },
  nextTitle: { ...font(type.subheadline), color: c.text },
  progressLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  track: { flex: 1, height: sizes.resumeBar, borderRadius: sizes.resumeBar, backgroundColor: c.surface3, overflow: 'hidden' as const },
  fill: { height: sizes.resumeBar, backgroundColor: c.accent },
  left: { ...font(type.caption1), color: c.text2, fontVariant: ['tabular-nums' as const] },
  description: { ...font(type.footnote), color: c.text2 },
  noGuide: { ...font(type.subheadline), color: c.text3 },
  spacer: { flex: 1 },
  hint: { ...font(type.caption1), color: c.text3 },
}));
