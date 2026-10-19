import type { ComponentRef, Ref } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { colors, radius, size, spacing, type } from '@/theme';

export type TextFieldRef = ComponentRef<typeof TextInput>;

export function TextField({
  label,
  style,
  ref,
  ...props
}: Omit<TextInputProps, 'ref'> & { label: string; ref?: Ref<TextFieldRef> }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, style]}
        keyboardAppearance="dark"
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs2 },
  label: { ...type.label, color: colors.textSecondary },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: size.fieldHeight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
});
