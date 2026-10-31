/**
 * The update card of the desktop app and the sideloaded Android TV app
 * (design system §7.18). State: `src/platform/updates/`. The root layout
 * mounts one card; it shows nothing in a browser, on iPhone and iPad and on
 * Android phones.
 *
 * - Place: bottom trailing, over the content, above the mini player.
 *   Width 340. It does not block the page.
 * - Motion: in with a 12 pt slide and a fade (`smooth` spring), out with a
 *   160 ms fade. Reduced motion: the fade only.
 * - Focus: a card that opens by itself does not take the focus (the user
 *   may type). A card that opens after "Check for Updates…" focuses its
 *   first button. Esc closes it ("Later").
 * - TV: the same content in a centred TV panel (`Sheet`), which holds the
 *   remote's focus; the main button takes it. Back is "Later". The panel
 *   waits while a player is open and shows when the player closes.
 * - Over-the-air updates (phones, tablets, TV): `./ota-card.tsx`. One card
 *   shows at a time (`chooseUpdateCard`): a new app wins over an OTA update.
 */
import { usePathname } from 'expo-router';
import { type ComponentRef, type RefObject, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, Text, View } from 'react-native';
import Animated, { FadeOut, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Sheet } from '@/components/sheet';
import { Touchable } from '@/components/touchable';
import { usePlayerStore } from '@/player/store';
import {
  closeUpdateCard,
  installUpdate,
  laterUpdate,
  openInstallSettings,
  retryUpdate,
  updatesOnTV,
  updatesSupported,
  useUpdateStore,
  type UpdateState,
} from '@/platform/updates';
import { currentLabel, isBusy, offerLabel } from '@/platform/updates/machine';
import { otaActive, useOtaStore } from '@/platform/updates/ota';
import { chooseUpdateCard } from '@/platform/updates/ota-rules';
import { NOTES_INLINE_MAX, progressFraction, progressLabel } from '@/platform/updates/notes';
import { createStyles, type AppTheme, font, iconSize, motion, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { OtaUpdateCard } from './ota-card';

/** "Newest version" closes by itself after this time. */
const CURRENT_CLOSE_MS = 4000;
const CARD_WIDTH = 340;
/** The mini player (52) and its gap: the card stays above it. */
const BOTTOM_CLEARANCE = 52 + spacing.lg * 2;

/** TV: the panel waits on these screens (a video or the music player fills the screen). */
const PLAYER_PATHS = ['/player', '/now-playing'];

export function UpdateCardHost() {
  const state = useUpdateStore((st) => st.state);
  const ota = useOtaStore((st) => st.state);
  const playing = usePlayerStore((st) => st.playing);
  const pathname = usePathname();
  const playerOpen = PLAYER_PATHS.some((p) => pathname.startsWith(p));
  const choice = chooseUpdateCard(updatesSupported ? state : null, otaActive() ? ota : null, { playing, playerOpen });
  if (choice === 'ota') return <OtaUpdateCard state={ota} />;
  if (choice !== 'app') return null;
  return updatesOnTV ? <TvUpdatePanel state={state} /> : <UpdateCard state={state} />;
}

function TvUpdatePanel({ state }: { state: UpdateState }) {
  const pathname = usePathname();
  if (PLAYER_PATHS.some((p) => pathname.startsWith(p))) return null;
  // Back: "Later" (or close). During the download and the install nothing closes the panel.
  const onBack = () => {
    if (isBusy(state)) return;
    if (state.offer) laterUpdate();
    else closeUpdateCard();
  };
  return (
    <Sheet visible onClose={onBack}>
      <UpdateCardBody state={state} tv />
    </Sheet>
  );
}

function UpdateCard({ state }: { state: UpdateState }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const y = useSharedValue(12);
  const opacity = useSharedValue(0);
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const { offer } = state;

  useEffect(() => {
    y.set(withSpring(0, { ...motion.spring.smooth, reduceMotion: ReduceMotion.System }));
    opacity.set(withTiming(1, { duration: motion.duration.base }));
  }, [y, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));

  // Esc inside the card: "Later" (or close).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const card = cardRef.current as unknown as HTMLElement | null;
      if (!card?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      if (offer) laterUpdate();
      else closeUpdateCard();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [offer]);

  return (
    <View pointerEvents="box-none" style={[s.host, { right: l.gutter, bottom: BOTTOM_CLEARANCE }]}>
      <Animated.View exiting={FadeOut.duration(motion.duration.fast)} style={[s.shadow, style]}>
        <View style={s.card}>
          <UpdateCardBody state={state} cardRef={cardRef} />
        </View>
      </Animated.View>
    </View>
  );
}

/** The content of the card: the same on the desktop and on TV. */
function UpdateCardBody({ state, tv = false, cardRef }: { state: UpdateState; tv?: boolean; cardRef?: RefObject<ComponentRef<typeof View> | null> }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const actionsRef = useRef<ComponentRef<typeof View>>(null);
  const [showAll, setShowAll] = useState(false);
  const { phase, offer } = state;

  const title = titleFor(state, tv);
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(title);
  }, [title]);

  // Opened on purpose: the main button ("Install and restart", "Try again") takes the focus.
  useEffect(() => {
    if (!state.manual || Platform.OS !== 'web') return;
    const buttons = (actionsRef.current as unknown as HTMLElement | null)?.querySelectorAll?.<HTMLElement>('[role="button"]');
    buttons?.[buttons.length - 1]?.focus();
  }, [state.manual, phase.kind]);

  useEffect(() => {
    if (phase.kind !== 'current') return;
    const t = setTimeout(closeUpdateCard, CURRENT_CLOSE_MS);
    return () => clearTimeout(t);
  }, [phase.kind]);

  const notes = offer?.notes ?? [];
  const shownNotes = showAll ? notes : notes.slice(0, NOTES_INLINE_MAX);
  const showNotes = offer && (phase.kind === 'available' || phase.kind === 'error');
  // TV: the main button takes the remote's focus (the panel holds the focus).
  const focusMain = tv;
  const laterOrClose = offer && !offer.required ? laterUpdate : closeUpdateCard;
  const laterLabel = offer && !offer.required ? 'Later' : 'Close';

  return (
          <View
            ref={cardRef}
            style={[s.inner, tv && s.innerTV]}
            role="dialog"
            aria-modal={false}
            accessibilityLabel={title}
            accessibilityLiveRegion="polite">
            <View style={s.header}>
              <View style={[s.badge, phase.kind === 'error' && s.badgeError]}>
                <Icon name={iconFor(state)} size={scaled(iconSize.sm)} color={phase.kind === 'error' ? c.danger : c.accent} />
              </View>
              <View style={s.headerText}>
                <Text style={s.title} numberOfLines={2}>
                  {title}
                </Text>
                <Text style={s.subtitle} numberOfLines={2}>
                  {subtitleFor(state, tv)}
                </Text>
              </View>
              {phase.kind === 'current' ? (
                <Touchable
                  onPress={closeUpdateCard}
                  hitSlop={8}
                  radius={radius.pill}
                  accessibilityRole="button"
                  accessibilityLabel="Close">
                  <Icon name="xmark.circle.fill" size={scaled(iconSize.md)} color={c.text3} />
                </Touchable>
              ) : null}
            </View>

            {showNotes && shownNotes.length ? (
              <View style={s.notes} accessibilityLabel={`What is new: ${notes.join('. ')}`}>
                {shownNotes.map((line, i) => (
                  <View key={i} style={s.noteRow}>
                    <Text style={s.bullet}>•</Text>
                    <Text style={s.note}>{line}</Text>
                  </View>
                ))}
                {notes.length > NOTES_INLINE_MAX ? (
                  <Touchable onPress={() => setShowAll((v) => !v)} radius={radius.sm} accessibilityRole="button">
                    <Text style={s.more}>{showAll ? 'Show less' : `Show all (${notes.length})`}</Text>
                  </Touchable>
                ) : null}
              </View>
            ) : null}

            {phase.kind === 'downloading' ? (
              <View style={s.progressBlock}>
                <View
                  style={s.track}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progressFraction(phase.done, phase.total) * 100)}>
                  <View style={[s.fill, { width: `${Math.max(2, progressFraction(phase.done, phase.total) * 100)}%` }]} />
                </View>
                <Text style={s.progressText}>{progressLabel(phase.done, phase.total)}</Text>
              </View>
            ) : null}

            {phase.kind === 'error' ? (
              <Text style={s.error} numberOfLines={3} selectable>
                {phase.message}
              </Text>
            ) : null}

            {phase.kind === 'checking' || phase.kind === 'installing' ? (
              <View style={s.busy}>
                <ActivityIndicator size="small" color={c.text2} />
                <Text style={s.progressText}>
                  {phase.kind === 'checking' ? 'Checking…' : tv ? 'The system installer opens. Confirm the update there.' : 'Installing. Zoggyfin restarts.'}
                </Text>
              </View>
            ) : null}

            {phase.kind === 'permission' ? (
              <Text style={s.progressText}>
                Turn on Install unknown apps for Zoggyfin in Settings (Fire TV: My Fire TV, Developer options), then come back.
              </Text>
            ) : null}

            {phase.kind === 'available' ? (
              <View ref={actionsRef} style={s.actions}>
                <Button variant="smallTonal" title={laterLabel} onPress={laterOrClose} />
                <Button variant="small" title={tv ? 'Install' : 'Install and restart'} onPress={() => void installUpdate()} preferredFocus={focusMain} />
              </View>
            ) : null}
            {phase.kind === 'permission' ? (
              <View ref={actionsRef} style={s.actions}>
                <Button variant="smallTonal" title={laterLabel} onPress={laterOrClose} />
                <Button variant="small" title="Open Settings" onPress={openInstallSettings} preferredFocus={focusMain} />
              </View>
            ) : null}
            {phase.kind === 'error' ? (
              <View ref={actionsRef} style={s.actions}>
                <Button variant="smallTonal" title={offer ? laterLabel : 'Close'} onPress={offer ? laterOrClose : closeUpdateCard} />
                <Button variant="small" title="Try again" onPress={retryUpdate} preferredFocus={focusMain} />
              </View>
            ) : null}
          </View>
  );
}

function titleFor(state: UpdateState, tv: boolean): string {
  const { phase, offer } = state;
  switch (phase.kind) {
    case 'checking':
      return 'Checking for updates';
    case 'current':
      return 'Zoggyfin is up to date';
    case 'downloading':
      return `Downloading Zoggyfin ${offer ? offerLabel(offer) : ''}`.trim();
    case 'installing':
      return `Installing Zoggyfin ${offer ? offerLabel(offer) : ''}`.trim();
    case 'permission':
      return tv ? 'Allow Zoggyfin to install the update' : 'Zoggyfin';
    case 'error':
      return phase.step === 'check'
        ? 'Cannot check for updates'
        : phase.step === 'download'
          ? 'The download failed'
          : 'The update did not install';
    default:
      return offer ? `Zoggyfin ${offerLabel(offer)} is available` : 'Zoggyfin';
  }
}

function subtitleFor(state: UpdateState, tv: boolean): string {
  const { phase } = state;
  const current = currentLabel(state);
  switch (phase.kind) {
    case 'current':
      return `Version ${current} is the newest version.`;
    case 'checking':
      return `You have version ${current}.`;
    case 'error':
      return phase.step === 'check'
        ? `Make sure that this ${tv ? 'TV' : 'Mac'} is online, then try again.`
        : `You have version ${current}. Nothing changed.`;
    case 'downloading':
    case 'installing':
      return tv ? `You have version ${current}.` : 'You can continue to use Zoggyfin.';
    default:
      return `You have version ${current}.`;
  }
}

function iconFor(state: UpdateState) {
  switch (state.phase.kind) {
    case 'error':
      return 'exclamationmark.triangle' as const;
    case 'current':
      return 'checkmark.circle.fill' as const;
    default:
      return 'arrow.down.circle' as const;
  }
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  host: { position: 'absolute' as const, zIndex: 900, alignItems: 'flex-end' as const, left: spacing.lg },
  shadow: { borderRadius: radius.lg, width: '100%' as const, maxWidth: scaled(CARD_WIDTH), ...shadow('floating') },
  // Solid, not glass: the notes must stay legible over artwork.
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden' as const,
    borderCurve: 'continuous' as const,
    backgroundColor: c.surface,
    borderWidth: sizes.hairline,
    borderColor: c.separator,
  },
  inner: { padding: spacing.lg, gap: spacing.md },
  // TV: the panel (Sheet) has its own surface and padding.
  innerTV: { padding: 0 },
  header: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: spacing.md },
  badge: {
    width: scaled(sizes.settingsIcon),
    height: scaled(sizes.settingsIcon),
    borderRadius: sizes.settingsIconRadius,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  badgeError: { backgroundColor: c.surface3 },
  headerText: { flex: 1, gap: spacing.xxs },
  title: { ...font(type.headline), color: c.text },
  subtitle: { ...font(type.footnote), color: c.text2 },
  notes: { gap: spacing.xs },
  noteRow: { flexDirection: 'row' as const, gap: spacing.sm },
  bullet: { ...font(type.subheadline), color: c.text3 },
  note: { ...font(type.subheadline), color: c.text, flex: 1 },
  more: { ...font(type.subheadline), fontWeight: '600' as const, color: c.accent, paddingVertical: spacing.xxs },
  progressBlock: { gap: spacing.xs },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: c.surface3, overflow: 'hidden' as const },
  fill: { height: 4, borderRadius: radius.pill, backgroundColor: c.accent },
  progressText: { ...font(type.footnote, { tabular: true }), color: c.text2 },
  busy: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  error: { ...font(type.footnote), color: c.danger },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: spacing.sm },
}));
