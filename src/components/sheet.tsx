import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, motion, radius, scaled, sizes, spacing, type, useStyles } from '@/theme';

import { Touchable } from './touchable';

const ENTER = Easing.bezier(...motion.easing.enter);

/**
 * A bottom sheet (web and phone; a centred panel on TV). The scrim fades,
 * the panel moves up from the bottom edge and leaves the same way, faster.
 */
export function Sheet({
  visible,
  title,
  onClose,
  doneLabel,
  children,
}: {
  visible: boolean;
  title?: string | null;
  onClose: () => void;
  /** A trailing text button in the header (for example "Done"). */
  doneLabel?: string;
  children: ReactNode;
}) {
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)} style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" focusable={false} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.host, isTV && s.hostTV]} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(motion.duration.base).easing(ENTER)}
          exiting={SlideOutDown.duration(motion.duration.fast)}
          style={[s.panel, isTV ? s.panelTV : { paddingBottom: insets.bottom + spacing.md }]}
          accessibilityViewIsModal>
          {isTV ? null : <View style={s.grabber} />}
          {title || doneLabel ? (
            <View style={s.header}>
              <Text style={s.title} numberOfLines={1} accessibilityRole="header">
                {title}
              </Text>
              {doneLabel ? (
                <Touchable onPress={onClose} hitSlop={10} radius={8} accessibilityRole="button" accessibilityLabel={doneLabel}>
                  <Text style={s.done}>{doneLabel}</Text>
                </Touchable>
              ) : null}
            </View>
          ) : null}
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A row in a sheet group. The last row in a group has no separator. */
export function SheetRow({
  children,
  onPress,
  last,
  accessibilityLabel,
  accessibilityRole = 'button',
  checked,
  preferredFocus,
}: {
  children: ReactNode;
  onPress: () => void;
  last?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'radio' | 'checkbox';
  checked?: boolean;
  preferredFocus?: boolean;
}) {
  const s = useStyles(makeStyles);
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={checked === undefined ? undefined : { checked }}
      style={({ pressed, hovered, focused }) => [s.row, (pressed || hovered || focused) && s.rowActive]}>
      <View style={[s.rowInner, !last && s.rowLine]}>{children}</View>
    </Touchable>
  );
}

export const makeSheetStyles = createStyles(({ c }: AppTheme) => ({
  group: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  rowText: { ...font(type.body), color: c.text, flex: 1 },
}));

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
  host: { flex: 1, justifyContent: 'flex-end' as const },
  hostTV: { justifyContent: 'center' as const, alignItems: 'center' as const },
  panel: {
    alignSelf: 'center' as const,
    width: '100%' as const,
    maxWidth: sizes.sheetMaxWidth,
    maxHeight: '80%' as const,
    backgroundColor: c.bgGrouped,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    borderCurve: 'continuous' as const,
    ...shadow('overlay'),
  },
  panelTV: { maxWidth: scaled(sizes.sheetMaxWidth), borderRadius: radius.xxl, padding: scaled(spacing.xxl) },
  grabber: { alignSelf: 'center' as const, width: 36, height: 5, borderRadius: 3, backgroundColor: c.surface3, marginTop: spacing.sm, marginBottom: spacing.sm },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  title: { ...font(type.headline), color: c.text, flex: 1 },
  done: { ...font(type.headline), color: c.accent },
  row: { backgroundColor: c.surface, paddingLeft: spacing.lg },
  rowActive: { backgroundColor: c.surface3 },
  rowInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.settingsRow + 6),
    paddingRight: spacing.lg,
  },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator },
}));
