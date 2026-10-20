/** Shared parts of the together sheet: sections, rows and styles. */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { createStyles, type AppTheme, font, fontFamily, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

export function Section({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.section}>
      <Text style={s.header} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}

export function RowIcon({ name }: { name: IconName }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={s.rowIcon}>
      <Icon name={name} size={16} color={c.text} />
    </View>
  );
}

/** A choice row with a check mark ("Who can join?", "Who can find it"). */
export function ChoiceRow({
  title,
  detail,
  selected,
  onPress,
  last,
  disabled,
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  last?: boolean;
  disabled?: boolean;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={({ pressed }) => [s.row, !last && s.rowLine, pressed && { backgroundColor: c.surface2 }, disabled && { opacity: 0.5 }]}>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        {detail ? <Text style={s.rowDetail}>{detail}</Text> : null}
      </View>
      <Icon name={selected ? 'checkmark.circle.fill' : 'circle'} size={22} color={selected ? c.accent : c.text3} />
    </Pressable>
  );
}

const monoFamily = Platform.select({ ios: 'Menlo', android: 'monospace', default: fontFamily.webMono });

export const makeStyles = createStyles(({ c }: AppTheme) => ({
  section: { gap: spacing.sm },
  header: { ...font(type.footnote), color: c.text2, letterSpacing: 0.4, paddingHorizontal: spacing.xs },
  footer: { ...font(type.footnote), color: c.text2, paddingHorizontal: spacing.xs },
  label: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text, paddingHorizontal: spacing.xs, marginTop: spacing.xs },
  note: { ...font(type.subheadline), color: c.text2, paddingHorizontal: spacing.xs },
  notice: { ...font(type.footnote), color: c.warning, paddingHorizontal: spacing.xs },
  group: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.settingsRow + 6),
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...font(type.body), color: c.text },
  rowDetail: { ...font(type.footnote), color: c.text2, flexShrink: 1 },
  rowIcon: { width: 29, height: 29, borderRadius: 7, backgroundColor: c.surface3, alignItems: 'center' as const, justifyContent: 'center' as const },
  buttonRow: { flexDirection: 'row' as const, gap: spacing.md },
  cardButtons: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  helpRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  helpText: { gap: spacing.xs },
  helpAction: { flexDirection: 'row' as const, marginTop: spacing.xs },
  codeWrap: { gap: spacing.xs, marginTop: spacing.xs },
  codeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  codeInput: {
    ...font(type.body),
    fontFamily: monoFamily,
    letterSpacing: 2,
    flex: 1,
    minWidth: 0,
    color: c.text,
    backgroundColor: c.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: scaled(40),
    borderWidth: 1,
    borderColor: c.controlBorder,
    borderCurve: 'continuous' as const,
  },
  searchInput: { fontFamily: undefined, letterSpacing: 0, flex: 0 },
  codeCard: { alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
  shortCode: { ...font(type.title2), fontFamily: monoFamily, fontWeight: '600' as const, letterSpacing: 3, color: c.text, textAlign: 'center' as const },
  wifiFacts: { alignSelf: 'stretch' as const, gap: 2 },
  wifiLabel: { ...font(type.footnote), color: c.text2 },
  wifiValue: { ...font(type.body), fontFamily: monoFamily, color: c.text, marginBottom: spacing.xs },
  expand: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingLeft: spacing.lg + 29 + spacing.md },
}));
