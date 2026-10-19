import type { ComponentRef, Ref } from 'react';
import { Text, TextInput, type TextInputProps, View } from 'react-native';

import { createStyles, type AppTheme, font, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

export type TextFieldRef = ComponentRef<typeof TextInput>;

/** A labelled text field: `surface` fill, a `controlBorder` edge (3:1), `accent` caret. */
export function TextField({
  label,
  style,
  ref,
  ...props
}: Omit<TextInputProps, 'ref'> & { label: string; ref?: Ref<TextFieldRef> }) {
  const s = useStyles(makeStyles);
  const { c, scheme } = useTheme();
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.text3}
        selectionColor={c.accent}
        cursorColor={c.accent}
        style={[s.input, style]}
        keyboardAppearance={scheme}
        {...props}
      />
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { gap: spacing.xs + 2 },
  label: { ...font(type.footnote), fontWeight: '500' as const, color: c.text2 },
  input: {
    ...font(type.body),
    color: c.text,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: scaled(sizes.fieldHeight),
    borderWidth: 1,
    borderColor: c.controlBorder,
    borderCurve: 'continuous' as const,
  },
}));
