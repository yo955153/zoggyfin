import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BaseItemDto } from '@/api/types';
import { useItemActions } from '@/features/actions/use-item-actions';
import { colors, iconSize, radius, size, spacing, type } from '@/theme';

import { Icon } from './icon';

/** The item action sheet. Its rows come from the item action registry. */
export function ItemActionSheet({
  item,
  visible,
  onClose,
}: {
  item: BaseItemDto | undefined;
  visible: boolean;
  onClose: () => void;
}) {
  const { actions, run } = useItemActions(item);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.title} numberOfLines={1}>
          {item?.Name}
        </Text>
        {actions.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              run(a);
            }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.row,
              (pressed || hovered) && styles.rowActive,
            ]}>
            <Icon name={a.icon} size={iconSize.lg} color={a.destructive ? colors.danger : colors.text} />
            <Text style={[styles.rowText, a.destructive && { color: colors.danger }]}>{a.title}</Text>
          </Pressable>
        ))}
        <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: size.sheetMaxWidth,
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  title: { ...type.bodyStrong, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.row, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  rowActive: { backgroundColor: colors.pressedRow },
  rowText: { ...type.body, color: colors.text },
  cancel: { marginTop: spacing.sm, paddingVertical: spacing.row, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.surface },
  cancelText: { ...type.bodyStrong, color: colors.text },
});
