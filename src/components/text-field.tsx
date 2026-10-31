import { type ComponentRef, type Ref, useState } from 'react';
import { Text, TextInput, type TextInputProps, View } from 'react-native';

import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, mediaColors, radius, scaled, sizes, spacing, tv, type, useStyles, useTheme } from '@/theme';

export type TextFieldRef = ComponentRef<typeof TextInput>;

/**
 * A labelled text field: `surface` fill, a `controlBorder` edge (3:1), `accent`
 * caret. TV: the focused field has a white edge, like the focus ring of the
 * other controls, so the remote shows where it is.
 */
export function TextField({
  label,
  style,
  ref,
  ...props
}: Omit<TextInputProps, 'ref'> & { label: string; ref?: Ref<TextFieldRef> }) {
  const s = useStyles(makeStyles);
  const { c, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.text3}
        selectionColor={c.accent}
        cursorColor={c.accent}
        style={[s.input, style, isTV && focused && s.inputFocusedTV]}
        keyboardAppearance={scheme}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
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
  inputFocusedTV: { borderWidth: tv.focusRingWidth, borderColor: mediaColors.white, paddingHorizontal: spacing.lg - (tv.focusRingWidth - 1) },
}));
