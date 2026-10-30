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
import { Icon, type IconName } from '@/components/icon';
import { ToastHost } from '@/components/toast-host';
import { useHideDevToolsButton } from '@/lib/dev-tools';
import { episodeLabel } from '@/lib/format';
import { KeyInput } from '@/native/key-input';
import { VideoSurface } from '@/player/engine';
import type { VideoFit } from '@/player/engine-types';
import type { KeyPress } from '@/native/key-input-types';
import { nextUpPhase, nextUpStartsAt, skipPromptAt } from '@/player/segments';
import { videoSession } from '@/player/session';
import { useShowsPause } from '@/player/control-gate';
import { playerState, setPlayerState, usePlayerStore } from '@/player/store';
import { chapterAt, formatTime } from '@/player/timeline';
import { MAX_BITRATE, QUALITY_OPTIONS, qualityLabel, usePlaybackSettings } from '@/settings/playback';
import { breakpointFor, layout } from '@/theme/theme';
import { TogetherSheetHost } from '@/features/together/together-sheet';
import { TogetherPill } from '@/features/together/together-pill';
import { useSessionStore } from '@/auth/session-store';
import { type FocusTarget, focusView, TvFocusGuide } from '@/features/tv/focus';
import { useTvBack } from '@/features/tv/use-tv-back';
import { useTvRemote } from '@/features/tv/use-tv-remote';
import { features, isNativeTV, isTV } from '@/platform/tv';
import {
  createTapGate,
  DOUBLE_PRESS_MS,
  DOUBLE_PRESS_SEEK,
  NO_RUN,
  nextRun,
  playerKeyAction,
  SCRUB_COMMIT_MS,
  type ScrubRun,
  scrubTarget,
  type SeekFeedback,
  stackFeedback,
  type TvKey,
  tvKeyFromEvent,
  tvKeyFromWeb,
} from '@/player/tv-keys';
import { nearby, nearbySupported } from '@/together/nearby';
import { openTogetherSheet, togetherState } from '@/together/store';
import { syncPlaySupported } from '@/together/syncplay';

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
const SKIP_GLYPHS = [5, 10, 15, 30, 60] as const;
type SkipGlyph = (typeof SKIP_GLYPHS)[number];

function skipIcon(dir: 'back' | 'forward', seconds: number): IconName {
  const n: SkipGlyph = SKIP_GLYPHS.find((g) => g === seconds) ?? 10;
  return dir === 'back' ? `gobackward.${n}` : `goforward.${n}`;
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace(useSessionStore.getState().session ? '/' : '/sign-in');
}

/**
 * Close: stop playback and leave the player. A nearby guest with an account
 * stays in the room (the next item opens here again); a guest with no
 * account has nothing else to do, so it leaves the session.
 */
function closePlayer() {
  const t = togetherState();
  if (t.mode === 'nearby' && t.role === 'guest' && !useSessionStore.getState().session) void nearby().stopAll();
  void videoSession().stop();
  leave();
}

/** Minimize: keep playing in the mini player. With no account (a nearby guest) there is no mini player. */
function minimizePlayer() {
  if (!useSessionStore.getState().session) return;
  if (playerState().now) setPlayerState({ presentation: 'mini' });
  videoSession().refreshLists();
  leave();
}

type SheetKind = 'tracks' | 'settings' | 'screen' | null;

const FITS: { fit: VideoFit; label: string; detail: string }[] = [
  { fit: 'contain', label: 'Fit', detail: 'Shows the whole picture' },
  { fit: 'cover', label: 'Fill', detail: 'Crops the picture to fill the screen' },
  { fit: 'fill', label: 'Stretch', detail: 'Stretches the picture to the screen' },
];

/**
 * The full-screen video player (design-system §7.8): video, gestures,
 * auto-hiding controls, skip and next-episode prompts, and the option sheets.
 */

/** TV: the control row that has the focus. */
type FocusRow = 'top' | 'center' | 'bar' | null;
export function PlayerScreen() {
  useHideDevToolsButton();
  const now = usePlayerStore((s) => s.now);
  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);
  const playing = usePlayerStore((s) => s.playing);
  const showsPause = useShowsPause();
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  const rate = usePlayerStore((s) => s.rate);
  const settings = usePlaybackSettings();
  const signedIn = useSessionStore((x) => !!x.session);
  const togetherAvailable = features.watchTogether && (nearbySupported || (syncPlaySupported && signedIn));
  const server = useImageServer();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const gutter = layout.gutter[breakpointFor(width)];

  const [visible, setVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [fit, setFit] = useState<VideoFit>('contain');
  const [poke, setPoke] = useState(0);
  const [dismissal, setDismissal] = useState<{ itemId: string; at: number } | null>(null);
  const [ripple, setRipple] = useState<SeekFeedback | null>(null);
  // TV: a double press with the controls hidden shows only the bubble and a thin progress line.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );

  // With no account, a player with nothing to play (a link, a fallback route) goes to the sign-in screen.
  // A short wait: a play request sets the item just after the route opens.
  useEffect(() => {
    if (signedIn || now || status !== 'idle') return;
    const t = setTimeout(() => {
      const st = playerState();
      if (!useSessionStore.getState().session && !st.now && st.status === 'idle') router.replace('/sign-in');
    }, 800);
    return () => clearTimeout(t);
  }, [signedIn, now, status]);

  // When the route goes away without Close (system back, web back), keep playing in the mini player.
  useEffect(() => {
    setPlayerState({ presentation: 'full' });
    return () => {
      if (playerState().presentation === 'full') setPlayerState({ presentation: playerState().now ? 'mini' : 'hidden' });
    };
  }, []);

  const wake = useCallback(() => {
    setVisible(true);
    setPeek(false);
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
    const t = setTimeout(() => setVisible(false), isTV ? 4000 : player.autoHideMs);
    return () => clearTimeout(t);
  }, [visible, playing, scrubbing, sheet, poke]);

  // A Cancel on the next-up card belongs to one item.
  const itemId = now?.item.Id ?? '';
  const dismissedAt = dismissal?.itemId === itemId ? dismissal.at : null;

  useEffect(() => {
    if (!ripple) return;
    // TV: a little longer, so a run of double presses adds up on screen.
    const t = setTimeout(() => setRipple(null), isTV ? PEEK_MS : 700);
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
      setRipple((r) => stackFeedback(r, side, step));
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
        if (signedIn && (e.translationY > 140 || e.velocityY > 900)) {
          dragY.set(withTiming(height, { duration: motion.duration.base, easing: ease.exit }));
          scheduleOnRN(minimizePlayer);
        } else {
          dragY.set(withSpring(0, { ...motion.spring.sheet, velocity: e.velocityY }));
        }
      });
    const pinch = Gesture.Pinch().onEnd((e) => {
      if (e.scale > 1.08) scheduleOnRN(setFit, 'cover');
      else if (e.scale < 0.92) scheduleOnRN(setFit, 'contain');
    });
    return Gesture.Simultaneous(pinch, Gesture.Race(pan, Gesture.Exclusive(double, single)));
  }, [toggleControls, onDoubleTap, dragY, height, signedIn]);

  const s = videoSession();
  const hasNext = !!now?.next;
  const prompt = now ? skipPromptAt(now.segments, position, duration, hasNext) : null;
  const startsAt = now ? nextUpStartsAt(now.segments, duration) : null;
  const phase = nextUpPhase({ position, startsAt, hasNext, dismissedAt });

  const playNext = useCallback(() => void videoSession().playNext(), []);
  const cancelNext = useCallback(() => setDismissal({ itemId, at: playerState().position }), [itemId]);

  // TV remote: a single Left or Right shows the controls (and the focus
  // moves as usual); a double press also seeks 10 s (player/tv-keys.ts).
  const tapGate = useRef(createTapGate()).current;
  // Controls hidden: a single Left or Right shows them only after the double-press window.
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );

  // TV scrubbing on the focused seek bar: Left and Right move a target
  // (a tap 10 s, a hold faster) with the time and a thumbnail; it seeks
  // 800 ms after the last press, or at once on Select. Back cancels it.
  // Left and Right never move the focus off the bar; Up leaves it.
  // Fallback: controls shown and no control has the focus: Left and Right scrub.
  const [barFocused, setBarFocused] = useState(false);
  const [scrubTo, setScrubToState] = useState<number | null>(null);
  const scrubToRef = useRef<number | null>(null);
  const setScrubTo = (v: number | null) => {
    scrubToRef.current = v;
    setScrubToState(v);
  };
  const controlFocus = useRef(0);
  const trackFocus = useCallback((on: boolean) => {
    controlFocus.current = Math.max(0, controlFocus.current + (on ? 1 : -1));
  }, []);
  // The row that has the focus now, and the row before it (TV focus repair on Down).
  const focusRow = useRef<{ now: FocusRow; before: FocusRow }>({ now: null, before: null });
  const enterRow = (row: FocusRow) => {
    if (focusRow.current.now !== row) focusRow.current = { now: row, before: focusRow.current.now };
  };
  const trackTop = useCallback((on: boolean) => {
    trackFocus(on);
    if (on) enterRow('top');
  }, [trackFocus]);
  const trackCenter = useCallback((on: boolean) => {
    trackFocus(on);
    if (on) enterRow('center');
  }, [trackFocus]);
  // The seek bar's view: Down from the center row goes to it.
  const [barView, setBarView] = useState<FocusTarget | null>(null);
  // Down showed the controls: the bar takes the focus, not Play.
  const [focusBar, setFocusBar] = useState(false);
  // Hidden controls are unmounted, maybe with no blur: start the count again.
  useEffect(() => {
    if (!visible) {
      controlFocus.current = 0;
      focusRow.current = { now: null, before: null };
    }
  }, [visible]);
  const scrubRun = useRef<ScrubRun>(NO_RUN);
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearScrubTimer = () => {
    if (scrubTimer.current) clearTimeout(scrubTimer.current);
    scrubTimer.current = null;
  };
  const stopHold = () => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
  };
  const endScrub = () => {
    clearScrubTimer();
    stopHold();
    scrubRun.current = NO_RUN;
    setScrubTo(null);
    setScrubbing(false);
  };
  const commitScrub = () => {
    const to = scrubToRef.current;
    endScrub();
    if (to !== null) s.seekTo(to);
    wake();
    console.log(`[tvkeys] scrub commit to=${to}`);
  };
  const cancelScrub = () => {
    endScrub();
    wake();
    console.log('[tvkeys] scrub cancel');
  };
  useEffect(
    () => () => {
      if (scrubTimer.current) clearTimeout(scrubTimer.current);
      if (holdTimer.current) clearInterval(holdTimer.current);
    },
    [],
  );
  const scrub = (dir: -1 | 1) => {
    const r = nextRun(scrubRun.current, dir, Date.now());
    scrubRun.current = r.run;
    // A held key repeats fast: only about 7 steps a second move the target.
    if (!r.apply) return;
    const from = scrubToRef.current ?? playerState().position;
    const to = scrubTarget(from, scrubRun.current, playerState().duration);
    setScrubTo(to);
    setScrubbing(true);
    wake();
    console.log(`[tvkeys] scrub dir=${dir} to=${to}`);
    clearScrubTimer();
    scrubTimer.current = setTimeout(commitScrub, SCRUB_COMMIT_MS);
  };
  /** Left and Right scrub: the bar has the focus, or no control has it. */
  const scrubsNow = () => isTV && visible && status !== 'error' && (barFocused || controlFocus.current <= 0);

  const onTvHold = (key: TvKey, start: boolean) => {
    if (key !== 'left' && key !== 'right') return;
    if (!start) {
      stopHold();
      return;
    }
    if (!scrubsNow()) return;
    const dir = key === 'left' ? -1 : 1;
    stopHold();
    scrub(dir);
    holdTimer.current = setInterval(() => scrub(dir), 150);
  };

  const onTvKey = (key: TvKey) => {
    const side = key === 'left' || key === 'right';
    // Every Left and Right counts toward a double press. With the controls hidden,
    // a single press waits out the window before it shows them, so a double press
    // seeks with the controls still hidden.
    const hidden = isTV && !visible;
    const gate = side ? tapGate.press(key, Date.now(), hidden) : { double: false, wait: false };
    if (!side) tapGate.cancel();
    const double = gate.double;
    if (gate.wait) {
      console.log(`[tvkeys] key=${key} wait (controls hidden)`);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => {
        revealTimer.current = null;
        if (tapGate.due(Date.now())) {
          console.log('[tvkeys] single press: show controls');
          wake();
        }
      }, DOUBLE_PRESS_MS);
      return;
    }
    if (double && hidden) {
      // Seek with only the feedback bubble; the controls stay hidden.
      const seconds = key === 'left' ? -DOUBLE_PRESS_SEEK : DOUBLE_PRESS_SEEK;
      console.log(`[tvkeys] key=${key} double seek=${seconds} (controls hidden)`);
      s.skip(seconds);
      setRipple((r) => stackFeedback(r, seconds < 0 ? 'left' : 'right', seconds));
      setPeek(true);
      if (peekTimer.current) clearTimeout(peekTimer.current);
      peekTimer.current = setTimeout(() => setPeek(false), PEEK_MS);
      return;
    }
    console.log(
      `[tvkeys] key=${key} double=${double} visible=${visible} bar=${barFocused} controls=${controlFocus.current} row=${focusRow.current.now} target=${scrubToRef.current}`,
    );
    // A double press seeks 10 s, unless the bar has the focus or a scrub is pending: then it scrubs.
    const seeks = double && !barFocused && scrubToRef.current === null;
    if (side && !seeks && scrubsNow()) {
      scrub(key === 'left' ? -1 : 1);
      return;
    }
    if (key === 'back' && scrubToRef.current !== null) {
      cancelScrub();
      return;
    }
    if (isTV && key === 'down') {
      // Down shows the controls with the focus on the seek bar.
      if (!visible) setFocusBar(true);
      // Down from the center row must land on the bar. Android sends the key
      // after the focus moved: if it went up to the top row, send it to the bar.
      else if (!barFocused && focusRow.current.now === 'top' && focusRow.current.before === 'center' && focusView(barView)) {
        console.log('[tvkeys] focus repair: bar');
      }
    } else if (!visible) setFocusBar(false);
    const action = playerKeyAction(key, seeks);
    switch (action.type) {
      case 'seek':
        s.skip(action.seconds);
        setRipple((r) => stackFeedback(r, action.seconds < 0 ? 'left' : 'right', action.seconds));
        wake();
        break;
      case 'skip':
        s.skip(action.direction === 'back' ? -settings.skipBackSeconds : settings.skipForwardSeconds);
        wake();
        break;
      case 'togglePlay':
        s.togglePlay();
        wake();
        break;
      case 'play':
        if (!playerState().playing) s.togglePlay();
        wake();
        break;
      case 'pause':
        if (playerState().playing) s.togglePlay();
        wake();
        break;
      case 'close':
        // TV (Netflix style): Back hides the controls first; Back with them hidden leaves the player.
        if (sheet) setSheet(null);
        else if (isTV && visible) setVisible(false);
        else closePlayer();
        break;
      case 'wake':
        wake();
        break;
      case 'none':
        break;
    }
  };
  useTvRemote(!sheet, (e) => {
    console.log(`[tvkeys] event type=${e.eventType} action=${String(e.eventKeyAction)} tag=${String(e.tag)}`);
    const ev = tvKeyFromEvent(e);
    if (!ev) return;
    if (ev.phase === 'press') onTvKey(ev.key);
    else onTvHold(ev.key, ev.phase === 'holdStart');
  });
  // Back closes the player (a sheet first). Phones keep the system back (minimize).
  useTvBack(isNativeTV, () => onTvKey('back'));

  const onKey = (k: KeyPress) => {
    if (isTV) {
      // Web TV preview: the keyboard stands in for the remote.
      const key = tvKeyFromWeb(k.key);
      if (key) onTvKey(key);
      return;
    }
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
        else setFit((f) => (f === 'contain' ? 'cover' : 'contain'));
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
        ...(now.plan.isLocal
          ? [
              {
                title: now.plan.fromPeer ? 'Quality · Nearby' : 'Quality · Downloaded',
                rows: [
                  {
                    key: 'local',
                    label: now.plan.fromPeer ? "Streams the host's file" : 'Plays the file on this device',
                    selected: true,
                    onPress: () => undefined,
                  },
                ],
              },
            ]
          : [
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
            ]),
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
      {/* TV: the focus stays in the player. */}
      <TvFocusGuide trapFocus={isNativeTV} style={styles.root}>
      <Animated.View style={[styles.root, frameStyle]} onPointerMove={onPointerMove}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* Audio plays now (this screen is about to close): no video surface, so no old frame shows. */}
          {now?.kind === 'audio' ? null : <VideoSurface fit={fit} style={StyleSheet.absoluteFill} />}
        </View>

        <GestureDetector gesture={gestures}>
          <View style={StyleSheet.absoluteFill} accessible={false} />
        </GestureDetector>

        {/* TV, controls hidden: this layer holds the focus, so Select plays or pauses and shows them. */}
        {isTV && !visible && status !== 'error' ? (
          <Pressable
            hasTVPreferredFocus
            focusable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={showsPause ? 'Pause' : 'Play'}
            ref={(v) => {
              // Web TV preview: no focus engine, so focus it by hand.
              if (v && Platform.OS === 'web') (v as unknown as HTMLElement).focus?.();
            }}
            onPress={() => {
              s.togglePlay();
              wake();
            }}
          />
        ) : null}

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

        {/* TV, controls hidden: after a double press, a thin progress line with the times only. */}
        {isTV && !visible && peek ? (
          <Animated.View
            entering={FadeIn.duration(motion.duration.fast)}
            exiting={FadeOut.duration(motion.duration.slow)}
            pointerEvents="none"
            style={[styles.bottom, { paddingBottom: bottomPad, paddingLeft: sideInset, paddingRight: sideInset }]}>
            <View style={styles.peekTrack}>
              <View style={[styles.peekFill, { width: `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%` }]} />
            </View>
            <View style={styles.peekTimes}>
              <Text style={[styles.time, styles.peekShadow]}>{formatTime(position)}</Text>
              <Text style={[styles.time, styles.peekShadow]}>{formatTime(-(Math.max(0, duration - position)))}</Text>
            </View>
          </Animated.View>
        ) : null}

        {/* Controls */}
        <Animated.View style={[StyleSheet.absoluteFill, controlsStyle]} pointerEvents={visible ? 'box-none' : 'none'}>
          {/* TV: hidden controls are not mounted, so Select never presses an unseen button. */}
          {!isTV || visible ? (
          <>
          <LinearGradient colors={player.topScrim} style={[styles.topScrim, { height: insets.top + 120 }]} pointerEvents="none" />
          <LinearGradient colors={player.bottomScrim} style={[styles.bottomScrim, { height: bottomPad + 180 }]} pointerEvents="none" />

          <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, paddingLeft: sideInset, paddingRight: sideInset }]} pointerEvents="box-none">
            <RoundButton onFocusChange={trackTop} icon="xmark" label="Close player" size={player.closeSize} glyph={iconSize.sm} onPress={closePlayer} />
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
              {/* TV: the system can say it has Picture in Picture and still refuse it (Google TV). */}
              {s.pipSupported && !isTV ? <PillButton onFocusChange={trackTop} icon="pip.enter" label="Picture in Picture" onPress={() => s.startPip()} /> : null}
              {togetherAvailable ? (
                <PillButton onFocusChange={trackTop} icon="person.2" label="Watch together" onPress={() => openTogetherSheet('player', null)} />
              ) : null}
              <PillButton onFocusChange={trackTop} icon="captions.bubble" label="Audio and subtitles" onPress={() => setSheet('tracks')} />
              {now?.kind === 'audio' ? null : (
                <PillButton onFocusChange={trackTop} icon="aspectratio" label="Screen size" onPress={() => setSheet('screen')} />
              )}
              <PillButton onFocusChange={trackTop} icon="gearshape" label="Quality and speed" onPress={() => setSheet('settings')} />
              {Platform.OS === 'web' ? (
                <PillButton onFocusChange={trackTop} icon="arrow.up.left.and.arrow.down.right" label="Full screen" onPress={() => s.toggleFullscreen(null)} />
              ) : null}
            </Glass>
          </View>
          <TogetherPill top={insets.top + spacing.sm + player.closeSize + spacing.sm} left={sideInset} onPress={() => openTogetherSheet('player', null)} />

          {!scrubbing && status !== 'error' ? (
            <View style={styles.center} pointerEvents="box-none">
              <RoundButton
                onFocusChange={trackCenter}
                nextFocusDown={barView}
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
                onFocusChange={trackCenter}
                nextFocusDown={barView}
                icon={loading ? undefined : showsPause ? 'pause.fill' : 'play.fill'}
                label={showsPause ? 'Pause' : 'Play'}
                size={player.playSize}
                glyph={iconSize.xxl}
                preferredFocus={isTV && visible && !focusBar}
                haptic
                onPress={() => {
                  wake();
                  s.togglePlay();
                }}>
                {loading ? <ActivityIndicator color={c.textOnMedia} size="large" /> : null}
              </RoundButton>
              <RoundButton
                onFocusChange={trackCenter}
                nextFocusDown={barView}
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
                tvTarget={scrubTo}
                tvRef={setBarView}
                tvPreferredFocus={isTV && visible && focusBar}
                onTvFocus={(on) => {
                  setBarFocused(on);
                  if (on) enterRow('bar');
                  console.log(`[tvkeys] bar focus=${on}`);
                  if (!on && scrubToRef.current !== null) commitScrub();
                }}
                onTvSelect={() => {
                  // Select seeks to a pending target, or plays and pauses.
                  if (scrubToRef.current !== null) commitScrub();
                  else {
                    s.togglePlay();
                    wake();
                  }
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
          </>
          ) : null}
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
      </TvFocusGuide>

      <PlayerSheet visible={sheet === 'tracks'} title="Audio & Subtitles" sections={trackSections} onClose={() => setSheet(null)} />
      <PlayerSheet visible={sheet === 'settings'} title="Playback" sections={settingsSections} onClose={() => setSheet(null)} />
      <PlayerSheet
        visible={sheet === 'screen'}
        title="Screen Size"
        sections={[{ title: 'Picture', rows: FITS.map((f) => ({ key: f.fit, label: f.label, detail: f.detail, selected: fit === f.fit, onPress: () => setFit(f.fit) })) }]}
        onClose={() => setSheet(null)}
      />
      <TogetherSheetHost where="player" />
      {/* Under the top bar and the Together pill, so it does not cover the controls. */}
      <ToastHost overlay offset={player.closeSize + spacing.sm * 2 + 32} />
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

function PillButton({
  icon,
  label,
  onPress,
  onFocusChange,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) => [
        styles.pillButton,
        (pressed || hovered) && styles.pillPressed,
        isTV && focused && styles.pillFocused,
      ]}>
      <Icon name={icon} size={iconSize.md} color={c.textOnMedia} />
    </Pressable>
  );
}

/** TV: how long the progress line stays after the last double press (ms). */
const PEEK_MS = 1500;

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
  // TV: the focused pill button turns white-filled, readable from across the room.
  pillFocused: { backgroundColor: 'rgba(255,255,255,0.35)' },
  center: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: player.centerGap,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -spacing.xs },
  peekTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  peekFill: { height: 4, backgroundColor: c.textOnMedia },
  peekTimes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  peekShadow: { textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
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
