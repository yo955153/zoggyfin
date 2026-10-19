import { Text } from 'react-native';

import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './icon';
import { Touchable } from './touchable';

/** A filter chip (design system §7.17): 32 pt pill, `surface2`; selected is a `text` fill with `bg` text. */
export function Chip({
  label,
  icon,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const fg = selected ? c.bg : c.text;
  return (
    <Touchable
      kind="button"
      radius={radius.pill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [s.chip, { backgroundColor: selected ? c.text : pressed ? c.surface3 : c.surface2 }]}>
      {icon ? <Icon name={icon} size={scaled(iconSize.sm - 3)} color={fg} weight="semibold" /> : null}
      <Text style={[s.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

const makeStyles = createStyles((_: AppTheme) => ({
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs + 2,
    height: scaled(sizes.chipHeight),
    paddingHorizontal: scaled(spacing.md),
    borderRadius: radius.pill,
  },
  label: { ...font(type.subheadline), fontWeight: '500' as const },
}));
