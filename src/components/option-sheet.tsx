import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, iconSize, radius, size, spacing, type } from '@/theme';

import { Icon } from './icon';

export interface Option<T> {
  value: T;
  label: string;
}

/** A bottom sheet to pick one or more options. Works the same on iOS and web. */
export function OptionSheet<T>({
  visible,
  title,
  options,
  selected,
  multiple,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Option<T>[];
  selected: readonly T[];
  multiple?: boolean;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.list}>
          {options.length === 0 ? <Text style={styles.empty}>No options</Text> : null}
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <Pressable
                key={String(o.value)}
                accessibilityRole={multiple ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: on }}
                onPress={() => {
                  onSelect(o.value);
                  if (!multiple) onClose();
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.row,
                  (pressed || hovered) && styles.rowActive,
                ]}>
                <Text style={[styles.rowText, on && styles.rowOn]}>{o.label}</Text>
                {on ? <Icon name="checkmark" size={iconSize.md} color={colors.accent} weight="semibold" /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: size.sheetMaxWidth,
    maxHeight: '70%',
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    paddingTop: spacing.md,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  title: { ...type.bodyStrong, color: colors.text },
  done: { ...type.bodyStrong, color: colors.accent },
  list: { paddingHorizontal: spacing.sm },
  empty: { ...type.callout, color: colors.textSecondary, padding: spacing.xl, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.row, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  rowActive: { backgroundColor: colors.pressedRow },
  rowText: { ...type.body, color: colors.text },
  rowOn: { ...type.bodyStrong, color: colors.accent },
});
