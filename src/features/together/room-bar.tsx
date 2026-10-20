/**
 * The room bar: while a together session runs, a slim bar over every tab
 * screen says what the room plays and who is in it ("Together · Dune ·
 * 3 people"). Tapping it opens the session sheet: the people, the
 * controls, the settings and "End session".
 *
 * Phones: above the tab bar (and the mini player). Web and the Mac app:
 * the same place, above the floating tab bar, at most 420 px wide.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Glass } from '@/features/player/glass';
import { ACCESSORY_HEIGHT, FLOATING_MINI_HEIGHT, HAS_ACCESSORY, TAB_BAR_HEIGHT } from '@/lib/tab-bar-inset';
import { isTV } from '@/platform/tv';
import { usePlayerStore } from '@/player/store';
import { createStyles, type AppTheme, font, spacing, type, useLayout, useStyles, useTheme } from '@/theme';
import { roomLabel } from '@/together/hub';
import { openTogetherSheet, useTogetherStore } from '@/together/store';

import { TogetherSheetHost } from './together-sheet';

/** The bar's distance from the bottom edge: above the tab bar and the mini player. */
function useBottom(): number {
  const insets = useSafeAreaInsets();
  const mini = usePlayerStore((s) => !!s.now && s.presentation === 'mini');
  const below = mini ? (HAS_ACCESSORY ? ACCESSORY_HEIGHT : FLOATING_MINI_HEIGHT + spacing.sm) : 0;
  return insets.bottom + TAB_BAR_HEIGHT + spacing.sm + below;
}

export function RoomBar() {
  const label = useTogetherStore(roomLabel);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const bottom = useBottom();
  if (!label || isTV) return null;
  const [, ...rest] = label.split(' · ');
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom, left: l.gutter, right: l.gutter }]}>
      <Pressable
        onPress={() => openTogetherSheet('room', null)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open the session.`}
        style={({ pressed }) => [styles.press, pressed && { opacity: 0.8 }]}>
        <Glass variant="regular" scheme="auto" style={s.bar}>
          <View style={s.dot}>
            <Icon name="person.2.fill" size={13} color={c.onAccent} />
          </View>
          <Text style={s.text} numberOfLines={1}>
            <Text style={s.strong}>Together</Text>
            {rest.length ? ` · ${rest.join(' · ')}` : ''}
          </Text>
          <Icon name="chevron.up" size={12} color={c.text2} weight="semibold" />
        </Glass>
      </Pressable>
    </View>
  );
}

/** Mount once over the tabs: the room bar and the session sheet that it opens. */
export function RoomLayer() {
  return (
    <>
      <RoomBar />
      <TogetherSheetHost where="room" />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignItems: 'center' },
  press: { width: '100%', maxWidth: 420 },
});

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  bar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    height: 40,
    paddingLeft: 6,
    paddingRight: spacing.md,
    borderRadius: 20,
    overflow: 'hidden' as const,
    ...shadow('floating'),
  },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  text: { ...font(type.subheadline), color: c.text, flex: 1, minWidth: 0 },
  strong: { fontWeight: '600' as const },
}));
