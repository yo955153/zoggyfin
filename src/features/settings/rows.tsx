/**
 * The rows and groups of the Settings screens (design system §7.15): inset
 * grouped sections, rows with a leading icon, info rows and action rows.
 */
import { Platform, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { createStyles, type AppTheme, font, iconSize, mediaColors, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

/** RN Web paints the "on" thumb green unless told otherwise; the RN types do not list the prop. */
export const webSwitchColors: object = Platform.OS === 'web' ? { activeThumbColor: mediaColors.white } : {};

/** An inset grouped section (design system §7.15). */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const styles = useStyles(makeSettingsStyles);
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

export function LeadingIcon({ name }: { name: IconName }) {
  const styles = useStyles(makeSettingsStyles);
  return (
    <View style={styles.leading}>
      <Icon name={name} size={scaled(iconSize.sm - 1)} color={mediaColors.white} />
    </View>
  );
}

export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  last,
  trailing,
  role = 'button',
  checked,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
  trailing?: React.ReactNode;
  role?: 'button' | 'radio' | 'switch';
  checked?: boolean;
}) {
  const styles = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityState={checked === undefined ? undefined : { checked }}
      style={({ pressed, hovered, focused }) => [styles.rowPad, (pressed || hovered || focused) && styles.rowPressed]}>
      <LeadingIcon name={icon} />
      <View style={[styles.row, styles.rowBody, !last && styles.rowBorder]}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.trailing}>
          {value ? (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {trailing ?? <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />}
        </View>
      </View>
    </Touchable>
  );
}

export function InfoRow({ icon, label, value, last }: { icon: IconName; label: string; value: string; last?: boolean }) {
  const styles = useStyles(makeSettingsStyles);
  return (
    <View style={styles.rowPad} accessible accessibilityLabel={`${label}: ${value}`}>
      <LeadingIcon name={icon} />
      <View style={[styles.row, styles.rowBody, !last && styles.rowBorder]}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={1} selectable>
          {value}
        </Text>
      </View>
    </View>
  );
}

export function ActionRow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const styles = useStyles(makeSettingsStyles);
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered, focused }) => [styles.row, styles.actionRow, (pressed || hovered || focused) && styles.rowPressed]}>
      <Text style={styles.destructive}>{label}</Text>
    </Touchable>
  );
}

export const makeSettingsStyles = createStyles(({ c, scheme }: AppTheme) => ({
  flex: { flex: 1 },
  page: { backgroundColor: c.bgGrouped },
  content: { padding: spacing.lg, paddingBottom: spacing.huge * 2 },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.settingsMaxWidth), alignSelf: 'center' as const, gap: spacing.xxl },
  account: { minHeight: scaled(sizes.settingsAccountRow + 12), gap: spacing.md, paddingHorizontal: spacing.lg },
  name: { ...font(type.headline), color: c.text },
  muted: { ...font(type.subheadline), color: c.text2, marginTop: spacing.xxs },
  section: { gap: spacing.sm - 2 },
  sectionTitle: { ...font(type.footnote), letterSpacing: 0.4, color: c.text2, marginLeft: spacing.lg },
  footer: { ...font(type.footnote), color: c.text2, marginHorizontal: spacing.lg },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  rowPad: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingLeft: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: scaled(sizes.settingsRow), gap: spacing.md },
  rowBody: { flex: 1, justifyContent: 'space-between' as const, paddingRight: spacing.lg, paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  rowPressed: { backgroundColor: c.surface3 },
  leading: {
    width: scaled(sizes.settingsIcon),
    height: scaled(sizes.settingsIcon),
    borderRadius: sizes.settingsIconRadius,
    backgroundColor: scheme === 'light' ? c.text3 : c.surface3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderCurve: 'continuous' as const,
  },
  label: { ...font(type.body), color: c.text, flexShrink: 1 },
  trailing: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, flexShrink: 1 },
  value: { ...font(type.body), color: c.text2, flexShrink: 1, textAlign: 'right' as const },
  actionRow: { justifyContent: 'center' as const },
  destructive: { ...font(type.body), color: c.danger, textAlign: 'center' as const },
}));
