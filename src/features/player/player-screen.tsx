import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useImageServer } from '@/api/use-api';
import { Icon } from '@/components/icon';
import { episodeLabel } from '@/lib/format';
import { KeyInput } from '@/native/key-input';
import { VideoSurface } from '@/player/engine';
import type { KeyPress } from '@/native/key-input-types';
import { nextUpPhase, nextUpStartsAt, skipPromptAt } from '@/player/segments';
import { videoSession } from '@/player/session';
import { playerState, setPlayerState, usePlayerStore } from '@/player/store';
import { chapterAt, formatTime } from '@/player/timeline';
import { MAX_BITRATE, QUALITY_OPTIONS, qualityLabel, usePlaybackSettings } from '@/settings/playback';
import { breakpointFor, layout } from '@/theme/theme';

import { AirPlayButton } from './airplay-button';
import { Glass } from './glass';
import { NextUpCard } from './next-up-card';
import { PlayerSheet, type SheetSection } from './player-sheet';
import { RoundButton } from './round-button';
import { Scrubber } from './scrubber';
import { SkipPill } from './skip-pill';
import { SubtitleOverlay } from './subtitle-overlay';
import { c, ease, iconSize, motion, player, radius, spacing, textStyle, type } from './tokens';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SKIP_GLYPHS = new Set([5, 10, 15, 30, 45, 60, 75, 90]);

function skipIcon(dir: 'back' | 'forward', seconds: number): string {
  const n = SKIP_GLYPHS.has(seconds) ? seconds : 10;
  return dir === 'back' ? `gobackward.${n}` : `goforward.${n}`;
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Close: stop playback and leave the player. */
function closePlayer() {
  void videoSession().stop();
  leave();
}

/** Minimize: keep playing in the mini player. */
function minimizePlayer() {
  if (playerState().now) setPlayerState({ presentation: 'mini' });
  videoSession().refreshLists();
  leave();
}

type SheetKind = 'tracks' | 'settings' | null;

/**
 * The full-screen video player (design-system §7.8): video, gestures,
 * auto-hiding controls, skip and next-episode prompts, and the option sheets.
 */
export function PlayerScreen() {
  const now = usePlayerStore((s) => s.now);
  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);
  const playing = usePlayerStore((s) => s.playing);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  const rate = usePlayerStore((s) => s.rate);
  const settings = usePlaybackSettings();
  const server = useImageServer();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const gutter = layout.gutter[breakpointFor(width)];

  const [visible, setVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [fill, setFill] = useState(false);
  const [poke, setPoke] = useState(0);
  const [dismissal, setDismissal] = useState<{ itemId: string; at: number } | null>(null);
  const [ripple, setRipple] = useState<{ side: 'left' | 'right'; seconds: number; key: number } | null>(null);

  // When the route goes away without Close (system back, web back), keep playing in the mini player.
  useEffect(() => {
    setPlayerState({ presentation: 'full' });
    return () => {
      if (playerState().presentation === 'full') setPlayerState({ presentation: playerState().now ? 'mini' : 'hidden' });
    };
  }, []);

  const wake = useCallback(() => {
    setVisible(true);
    setPoke((p) => p + 1);
  }, []);

  // Pointer movement (web, iPad trackpad) shows the controls, at most a few times a second.
  const lastMove = useRef(0);
  const onPointerMove = useCallback(() => {
    const now = Date.now();
    if (now - lastMove.current < 400) return;
    lastMove.current = now;
    wake();
  }, [wake]);

  // Auto-hide after 3 s while playing; never while paused, scrubbing or with a sheet open.
  useEffect(() => {
    if (!visible || !playing || scrubbing || sheet) return;
    const t = setTimeout(() => setVisible(false), player.autoHideMs);
    return () => clearTimeout(t);
  }, [visible, playing, scrubbing, sheet, poke]);

  // A Cancel on the next-up card belongs to one item.
  const itemId = now?.item.Id ?? '';
  const dismissedAt = dismissal?.itemId === itemId ? dismissal.at : null;

  useEffect(() => {
    if (!ripple) return;
    const t = setTimeout(() => setRipple(null), 700);
    return () => clearTimeout(t);
  }, [ripple]);

  const fade = useSharedValue(1);
  useEffect(() => {
    fade.set(withTiming(visible ? 1 : 0, { duration: motion.duration.fast, easing: visible ? ease.enter : ease.exit }));
  }, [visible, fade]);
  const controlsStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  // Swipe down to minimize; the frame follows the finger.
  const dragY = useSharedValue(0);
  const frameStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.get() }],
    opacity: reduced ? 1 - Math.min(0.6, dragY.get() / Math.max(1, height)) : 1,
  }));

  const toggleControls = useCallback(() => {
    if (visible) setVisible(false);
    else wake();
  }, [visible, wake]);

  const onDoubleTap = useCallback(
    (x: number) => {
      const third = width / 3;
      if (x > third && x < third * 2) {
        toggleControls();
        return;
      }
      const side: 'left' | 'right' = x <= third ? 'left' : 'right';
      const step = side === 'left' ? -settings.skipBackSeconds : settings.skipForwardSeconds;
      videoSession().skip(step);
      setRipple((r) => ({
        side,
        seconds: r && r.side === side ? r.seconds + Math.abs(step) : Math.abs(step),
        key: (r?.key ?? 0) + 1,
      }));
    },
    [width, settings.skipBackSeconds, settings.skipForwardSeconds, toggleControls],
  );

  const gestures = useMemo(() => {
    const single = Gesture.Tap()
      .maxDuration(300)
      .onEnd((_e, ok) => {
        if (ok) scheduleOnRN(toggleControls);
      });
    const double = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .onEnd((e, ok) => {
        if (ok) scheduleOnRN(onDoubleTap, e.x);
      });
    const pan = Gesture.Pan()
      .activeOffsetY(24)
      .failOffsetY(-24)
      .failOffsetX([-24, 24])
      .onUpdate((e) => {
        dragY.set(Math.max(0, e.translationY));
      })
      .onEnd((e) => {
        if (e.translationY > 140 || e.velocityY > 900) {
          dragY.set(withTiming(height, { duration: motion.duration.base, easing: ease.exit }));
          scheduleOnRN(minimizePlayer);
        } else {
          dragY.set(withSpring(0, { ...motion.spring.sheet, velocity: e.velocityY }));
        }
      });
    const pinch = Gesture.Pinch().onEnd((e) => {
      if (e.scale > 1.08) scheduleOnRN(setFill, true);
      else if (e.scale < 0.92) scheduleOnRN(setFill, false);
    });
    return Gesture.Simultaneous(pinch, Gesture.Race(pan, Gesture.Exclusive(double, single)));
  }, [toggleControls, onDoubleTap, dragY, height]);

  const s = videoSession();
  const hasNext = !!now?.next;
  const prompt = now ? skipPromptAt(now.segments, position, duration, hasNext) : null;
  const startsAt = now ? nextUpStartsAt(now.segments, duration) : null;
  const phase = nextUpPhase({ position, startsAt, hasNext, dismissedAt });

  const playNext = useCallback(() => void videoSession().playNext(), []);
  const cancelNext = useCallback(() => setDismissal({ itemId, at: playerState().position }), [itemId]);

  const onKey = (k: KeyPress) => {
    wake();
    switch (k.key) {
      case ' ':
      case 'k':
        s.togglePlay();
        break;
      case 'ArrowLeft':
      case 'j':
        s.skip(-(k.shift ? 30 : settings.skipBackSeconds));
        break;
      case 'ArrowRight':
      case 'l':
        s.skip(k.shift ? 30 : settings.skipForwardSeconds);
        break;
      case 'f':
        if (Platform.OS === 'web') s.toggleFullscreen(null);
        else setFill((f) => !f);
        break;
      case 'm':
        s.toggleMuted();
        break;
      case 'c': {
        const cur = now?.plan.subtitleIndex ?? null;
        const first = now?.plan.subtitles.find((x) => x.isText) ?? now?.plan.subtitles[0];
        void s.selectSubtitle(cur !== null ? null : (first?.index ?? null));
        break;
      }
      case 'Escape':
        if (sheet) setSheet(null);
        else closePlayer();
        break;
    }
  };

  const title = now?.item.Name ?? '';
  const chapter = now ? chapterAt(now.chapters, position)?.name : null;
  const sub =
    now?.item.Type === 'Episode'
      ? [now.item.SeriesName, episodeLabel(now.item)].filter(Boolean).join(' · ')
      : (chapter ?? (now?.item.ProductionYear ? String(now.item.ProductionYear) : null));

  const loading = status === 'loading' || status === 'buffering' || (status === 'idle' && !error);
  const sideInset = Math.max(gutter, insets.left + spacing.sm, insets.right + spacing.sm);

  const trackSections: SheetSection[] = now
    ? [
        {
          title: 'Audio',
          empty: 'No audio tracks',
          rows: now.plan.audio.map((a) => ({
            key: `a${a.index}`,
            label: a.label,
            detail: a.isDefault && !/default/i.test(a.label) ? 'Default' : null,
            selected: a.index === now.plan.audioIndex,
            onPress: () => void s.selectAudio(a.index),
          })),
        },
        {
          title: 'Subtitles',
          rows: [
            { key: 'off', label: 'Off', selected: now.plan.subtitleIndex === null, onPress: () => void s.selectSubtitle(null) },
            ...now.plan.subtitles.map((x) => ({
              key: `s${x.index}`,
              label: x.label,
              detail: [x.isForced ? 'Forced' : null, x.isText ? null : 'Burned in by the server'].filter(Boolean).join(' · ') || null,
              selected: x.index === now.plan.subtitleIndex,
              onPress: () => void s.selectSubtitle(x.index),
            })),
          ],
        },
      ]
    : [];

  const method = now?.plan.playMethod === 'Transcode' ? 'Transcoding' : now?.plan.playMethod === 'DirectStream' ? 'Direct stream' : 'Direct play';
  const settingsSections: SheetSection[] = now
    ? [
        {
          title: `Quality · ${method}`,
          rows: [
            {
              key: 'auto',
              label: 'Auto',
              detail: `From settings: ${qualityLabel(settings.wifiBitrate)} on Wi-Fi, ${qualityLabel(settings.cellularBitrate)} on cellular`,
              selected: now.bitrateChoice === null,
              onPress: () => void s.setQuality(null),
            },
            ...QUALITY_OPTIONS.map((q) => {
              const value = q.value === 0 ? MAX_BITRATE : q.value;
              return { key: `q${q.value}`, label: q.label, selected: now.bitrateChoice === value, onPress: () => void s.setQuality(value) };
            }),
          ],
        },
        {
          title: 'Playback Speed',
          rows: SPEEDS.map((sp) => ({
            key: `r${sp}`,
            label: sp === 1 ? 'Normal' : `${sp}×`,
            selected: Math.abs(rate - sp) < 0.01,
            onPress: () => s.setRate(sp),
          })),
        },
      ]
    : [];

  const bottomPad = Math.max(insets.bottom, spacing.md);

  return (
    <KeyInput enabled={!sheet} onKey={onKey} style={styles.root}>
      <StatusBar hidden={!visible} animated style="light" />
      <Animated.View style={[styles.root, frameStyle]} onPointerMove={onPointerMove}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <VideoSurface fill={fill} style={StyleSheet.absoluteFill} />
        </View>

        <GestureDetector gesture={gestures}>
          <View style={StyleSheet.absoluteFill} accessible={false} />
        </GestureDetector>

        <SubtitleOverlay bottom={visible ? 132 + bottomPad : bottomPad + spacing.xl} />

        {ripple ? (
          <Animated.View
            key={ripple.key}
            entering={FadeIn.duration(motion.duration.press)}
            exiting={FadeOut.duration(motion.duration.fast)}
            pointerEvents="none"
            style={[styles.ripple, ripple.side === 'left' ? { left: sideInset + spacing.xl } : { right: sideInset + spacing.xl }]}>
            <Glass style={styles.rippleInner}>
              <Text style={styles.rippleText}>{`${ripple.side === 'left' ? '−' : '+'}${ripple.seconds} s`}</Text>
            </Glass>
          </Animated.View>
        ) : null}

        {/* Controls */}
        <Animated.View style={[StyleSheet.absoluteFill, controlsStyle]} pointerEvents={visible ? 'box-none' : 'none'}>
          <LinearGradient colors={player.topScrim} style={[styles.topScrim, { height: insets.top + 120 }]} pointerEvents="none" />
          <LinearGradient colors={player.bottomScrim} style={[styles.bottomScrim, { height: bottomPad + 180 }]} pointerEvents="none" />

          <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, paddingLeft: sideInset, paddingRight: sideInset }]} pointerEvents="box-none">
            <RoundButton icon="player.xmark" label="Close player" size={player.closeSize} glyph={iconSize.sm} onPress={closePlayer} />
            <View style={styles.titleBlock}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {sub ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
            </View>
            <Glass style={styles.pill}>
              <AirPlayButton onOpen={wake} />
              {s.pipSupported ? <PillButton icon="pip.enter" label="Picture in Picture" onPress={() => s.startPip()} /> : null}
              <PillButton icon="captions.bubble" label="Audio and subtitles" onPress={() => setSheet('tracks')} />
              <PillButton icon="gearshape" label="Quality and speed" onPress={() => setSheet('settings')} />
              {Platform.OS === 'web' ? (
                <PillButton icon="arrow.up.left.and.arrow.down.right" label="Full screen" onPress={() => s.toggleFullscreen(null)} />
              ) : null}
            </Glass>
          </View>

          {!scrubbing && status !== 'error' ? (
            <View style={styles.center} pointerEvents="box-none">
              <RoundButton
                icon={skipIcon('back', settings.skipBackSeconds)}
                label={`Back ${settings.skipBackSeconds} seconds`}
                size={player.skipSize}
                glyph={iconSize.xl}
                onPress={() => {
                  wake();
                  s.skip(-settings.skipBackSeconds);
                }}>
                <SkipNumber seconds={settings.skipBackSeconds} />
              </RoundButton>
              <RoundButton
                icon={loading ? undefined : playing ? 'pause.fill' : 'play.fill'}
                label={playing ? 'Pause' : 'Play'}
                size={player.playSize}
                glyph={iconSize.xxl}
                haptic
                onPress={() => {
                  wake();
                  s.togglePlay();
                }}>
                {loading ? <ActivityIndicator color={c.textOnMedia} size="large" /> : null}
              </RoundButton>
              <RoundButton
                icon={skipIcon('forward', settings.skipForwardSeconds)}
                label={`Forward ${settings.skipForwardSeconds} seconds`}
                size={player.skipSize}
                glyph={iconSize.xl}
                onPress={() => {
                  wake();
                  s.skip(settings.skipForwardSeconds);
                }}>
                <SkipNumber seconds={settings.skipForwardSeconds} />
              </RoundButton>
            </View>
          ) : null}

          <View style={[styles.bottom, { paddingBottom: bottomPad, paddingLeft: sideInset, paddingRight: sideInset }]} pointerEvents="box-none">
            {now ? (
              <Scrubber
                position={position}
                duration={duration}
                buffered={buffered}
                playing={playing}
                chapters={now.chapters}
                trickplay={now.trickplay}
                server={server}
                itemId={now.item.Id ?? ''}
                mediaSourceId={now.plan.mediaSourceId}
                gutter={sideInset}
                onSeek={(t) => {
                  s.seekTo(t);
                  wake();
                }}
                onScrubbing={(on) => {
                  setScrubbing(on);
                  if (on) wake();
                }}
              />
            ) : null}
            <View style={styles.times}>
              <Text style={styles.time}>{formatTime(position)}</Text>
              <Text style={styles.time}>{formatTime(-(Math.max(0, duration - position)))}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Prompts stay visible with the controls hidden. */}
        <View
          style={[styles.prompts, { right: sideInset, bottom: visible ? bottomPad + 96 : bottomPad + spacing.lg }]}
          pointerEvents="box-none">
          {phase === 'counting' && now?.next ? (
            <NextUpCard next={now.next} onPlay={playNext} onCancel={cancelNext} autoplay={settings.autoplayNext} />
          ) : prompt ? (
            <SkipPill
              key={prompt.segment.start}
              label={prompt.label}
              onPress={() => {
                if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                s.seekTo(prompt.target);
              }}
            />
          ) : null}
        </View>

        {status === 'error' ? (
          <View style={styles.errorWrap} pointerEvents="box-none">
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Playback stopped</Text>
              <Text style={styles.errorText}>{error ?? 'The video could not be played.'}</Text>
              <View style={styles.errorActions}>
                <Pressable onPress={() => s.retry()} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryText}>Try Again</Text>
                </Pressable>
                <Pressable onPress={closePlayer} style={styles.closeBtn} accessibilityRole="button">
                  <Text style={styles.closeText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </Animated.View>

      <PlayerSheet visible={sheet === 'tracks'} title="Audio & Subtitles" sections={trackSections} onClose={() => setSheet(null)} />
      <PlayerSheet visible={sheet === 'settings'} title="Playback" sections={settingsSections} onClose={() => setSheet(null)} />
    </KeyInput>
  );
}

/** Web: Lucide's rotate arrows have no number, so the seconds sit inside (SF Symbols include it). */
function SkipNumber({ seconds }: { seconds: number }) {
  if (Platform.OS !== 'web') return null;
  return (
    <Text style={styles.skipNumber} accessible={false}>
      {seconds}
    </Text>
  );
}

function PillButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.pillButton, (pressed || hovered) && styles.pillPressed]}>
      <Icon name={icon} size={iconSize.md} color={c.textOnMedia} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { ...textStyle(type.headline), color: c.textOnMedia },
  subtitle: { ...textStyle(type.footnote), color: 'rgba(255,255,255,0.72)' },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, overflow: 'hidden', paddingHorizontal: spacing.xs },
  pillButton: { width: player.pillButton, height: player.pillButton, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  skipNumber: { position: 'absolute', fontSize: 10, lineHeight: 12, fontWeight: '700', color: c.textOnMedia, fontVariant: ['tabular-nums'] },
  pillPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  center: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: player.centerGap,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -spacing.xs },
  time: { ...textStyle(type.mono), color: c.textOnMedia, fontVariant: ['tabular-nums'] },
  prompts: { position: 'absolute', alignItems: 'flex-end', left: spacing.lg },
  ripple: { position: 'absolute', top: '45%' },
  rippleInner: { borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, overflow: 'hidden' },
  rippleText: { ...textStyle(type.headline), color: c.textOnMedia, fontVariant: ['tabular-nums'] },
  errorWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  errorCard: { backgroundColor: c.surface2, borderRadius: radius.lg, padding: spacing.xl, maxWidth: 360, gap: spacing.sm },
  errorTitle: { ...textStyle(type.headline), color: c.text },
  errorText: { ...textStyle(type.callout), color: c.text2 },
  errorActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  retry: { backgroundColor: c.accent, borderRadius: radius.lg, paddingHorizontal: spacing.lg, minHeight: 44, justifyContent: 'center' },
  retryText: { ...textStyle(type.headline), color: c.onAccent },
  closeBtn: { backgroundColor: c.surface3, borderRadius: radius.lg, paddingHorizontal: spacing.lg, minHeight: 44, justifyContent: 'center' },
  closeText: { ...textStyle(type.headline), color: c.text },
});
