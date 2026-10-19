import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { episodeLabel } from '@/lib/format';
import { openFullPlayer } from '@/player';
import { videoSession } from '@/player/session';
import { usePlayerStore } from '@/player/store';

import { createStyles, type AppTheme, font, useStyles, useTheme } from '@/theme';

import { Glass } from './glass';
import { iconSize, motion, radius, spacing, type } from './tokens';

/** True when the mini player should show: something plays and the full player is closed. */
export function useMiniPlayerVisible(): boolean {
  return usePlayerStore((s) => !!s.now && s.presentation === 'mini');
}

/**
 * The mini player (design-system §7.2): art, title, play/pause and close,
 * with a 2 pt progress line. Tap or swipe up opens the full player.
 * `inline` is the compact iOS 26 accessory placement.
 */
export function MiniPlayer({ inline = false, floating = false }: { inline?: boolean; floating?: boolean }) {
  const now = usePlayerStore((s) => s.now);
  const playing = usePlayerStore((s) => s.playing);
  const fraction = usePlayerStore((s) => (s.duration > 0 ? Math.min(1, s.position / s.duration) : 0));
  const styles = useStyles(makeStyles);
  const { c } = useTheme();
  const lift = useSharedValue(0);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));

  const swipe = Gesture.Pan()
    .activeOffsetY(-12)
    .failOffsetX([-20, 20])
    .onUpdate((e) => lift.set(Math.min(0, e.translationY) * 0.4))
    .onEnd((e) => {
      lift.set(withSpring(0, { ...motion.spring.smooth, velocity: e.velocityY }));
      if (e.translationY < -30 || e.velocityY < -500) scheduleOnRN(openFullPlayer);
    });

  if (!now) return null;
  const item = now.item;
  const sub = item.Type === 'Episode' ? [item.SeriesName, episodeLabel(item)].filter(Boolean).join(' · ') : (item.ProductionYear ? String(item.ProductionYear) : 'Video');
  const toggle = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    videoSession().togglePlay();
  };

  const content = (
    <Pressable onPress={openFullPlayer} accessibilityRole="button" accessibilityLabel={`Now playing: ${item.Name ?? ''}. Opens the player`} style={styles.row}>
      {!inline ? <ItemImage item={item} variant="landscape" width={38 * (16 / 9)} aspectRatio={16 / 9} rounded={radius.sm} hideArtTitle /> : null}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {item.Name}
        </Text>
        {!inline ? (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Pressable onPress={toggle} hitSlop={6} style={styles.button} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause.fill' : 'play.fill'} size={iconSize.md} color={c.text} weight="semibold" />
      </Pressable>
      {!inline ? (
        <Pressable onPress={() => void videoSession().stop()} hitSlop={6} style={styles.button} accessibilityRole="button" accessibilityLabel="Stop playback">
          <Icon name="xmark" size={iconSize.sm} color={c.text2} weight="semibold" />
        </Pressable>
      ) : null}
    </Pressable>
  );

  return (
    <GestureDetector gesture={swipe}>
      <Animated.View style={[styles.wrap, floating && styles.floating, liftStyle]}>
        {floating ? (
          <Glass variant="regular" scheme="auto" style={styles.capsule}>
            {content}
            <Progress fraction={fraction} />
          </Glass>
        ) : (
          <View style={styles.fillWrap}>
            {content}
            <Progress fraction={fraction} />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function Progress({ fraction }: { fraction: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.progressTrack} pointerEvents="none">
      <View style={[styles.progressFill, { transform: [{ translateX: `${(fraction - 1) * 100}%` }] }]} />
    </View>
  );
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  wrap: { flex: 1, width: '100%', justifyContent: 'center' },
  floating: { flex: 0, maxWidth: 400, alignSelf: 'center' },
  capsule: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...shadow('floating'),
  },
  fillWrap: { flex: 1, justifyContent: 'center', overflow: 'hidden', borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.sm, paddingRight: spacing.xs, minHeight: 52 },
  text: { flex: 1, minWidth: 0 },
  title: { ...font(type.tileTitle), color: c.text },
  sub: { ...font(type.caption1), color: c.text2 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 0, height: 2, overflow: 'hidden', borderRadius: 1 },
  progressFill: { ...StyleSheet.absoluteFill, backgroundColor: c.accent },
}));
