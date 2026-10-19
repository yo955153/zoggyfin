import { ActivityIndicator, Text, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './icon';
import { Touchable } from './touchable';

export type ButtonVariant = 'primary' | 'tonal' | 'tonalAccent' | 'small' | 'smallTonal' | 'text';

/**
 * Buttons (design system §7.17). Primary: 50 pt, `accent` fill, `onAccent`
 * text. Tonal: `surface2` fill. Small: 32 pt pill. Text: no fill, `accent`.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  containerStyle,
  accessibilityLabel,
  preferredFocus,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  preferredFocus?: boolean;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const small = variant === 'small' || variant === 'smallTonal';
  const fg =
    variant === 'primary' || variant === 'small'
      ? c.onAccent
      : variant === 'tonalAccent' || variant === 'text'
        ? c.accent
        : c.text;
  const r = small ? radius.pill : radius.lg;
  return (
    <Touchable
      kind={variant === 'text' ? 'plain' : 'button'}
      radius={r}
      onPress={onPress}
      disabled={disabled || loading}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      containerStyle={containerStyle}
      style={({ pressed }) => [
        s.base,
        small ? s.small : s.large,
        { borderRadius: r },
        variant === 'primary' || variant === 'small' ? { backgroundColor: pressed ? c.accentPressed : c.accent } : null,
        variant === 'tonal' || variant === 'tonalAccent' || variant === 'smallTonal' ? { backgroundColor: pressed ? c.surface3 : c.surface2 } : null,
        variant === 'text' ? s.text : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={scaled(small ? iconSize.sm - 2 : iconSize.sm)} color={fg} weight="semibold" /> : null}
          <Text style={[small ? s.labelSmall : variant === 'text' ? s.labelText : s.label, { color: fg }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Touchable>
  );
}

const makeStyles = createStyles((_: AppTheme) => ({
  base: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing.sm,
    borderCurve: 'continuous' as const,
  },
  large: { minHeight: scaled(sizes.buttonHeight), paddingHorizontal: scaled(spacing.xl) },
  small: { minHeight: scaled(sizes.buttonSmall), paddingHorizontal: scaled(spacing.lg) },
  text: { minHeight: scaled(sizes.iconButton), paddingHorizontal: spacing.sm },
  label: font(type.headline),
  labelSmall: { ...font(type.subheadline), fontWeight: '600' as const },
  labelText: font(type.body),
}));
