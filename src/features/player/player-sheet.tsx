import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';

import { c, iconSize, radius, spacing, textStyle, type } from './tokens';

export interface SheetRow {
  key: string;
  label: string;
  detail?: string | null;
  selected: boolean;
  onPress: () => void;
}

export interface SheetSection {
  title: string;
  rows: SheetRow[];
  empty?: string;
}

/**
 * The player's option sheet (Audio & Subtitles, Quality & Speed). Always
 * dark. Picking a row closes the sheet.
 */
export function PlayerSheet({
  visible,
  title,
  sections,
  onClose,
}: {
  visible: boolean;
  title: string;
  sections: SheetSection[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {sections.map((s) => (
            <View key={s.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{s.title}</Text>
              <View style={styles.card}>
                {s.rows.length === 0 ? <Text style={styles.empty}>{s.empty ?? 'None'}</Text> : null}
                {s.rows.map((r, i) => (
                  <Pressable
                    key={r.key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: r.selected }}
                    onPress={() => {
                      onClose();
                      if (!r.selected) r.onPress();
                    }}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.row,
                      i < s.rows.length - 1 && styles.rowBorder,
                      (pressed || hovered) && styles.rowActive,
                    ]}>
                    <View style={styles.rowText}>
                      <Text style={[styles.label, r.selected && styles.labelOn]} numberOfLines={2}>
                        {r.label}
                      </Text>
                      {r.detail ? (
                        <Text style={styles.detail} numberOfLines={1}>
                          {r.detail}
                        </Text>
                      ) : null}
                    </View>
                    {r.selected ? <Icon name="checkmark" size={iconSize.sm} color={c.accent} weight="semibold" /> : null}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    maxHeight: '75%',
    backgroundColor: c.surface2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: 'continuous',
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  title: { ...textStyle(type.headline), color: c.text },
  done: { ...textStyle(type.headline), color: c.accent },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: { ...textStyle(type.footnote), color: c.text2, marginLeft: spacing.sm, textTransform: 'uppercase' },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator },
  rowActive: { backgroundColor: c.surface3 },
  rowText: { flex: 1, gap: spacing.xxs },
  label: { ...textStyle(type.body), color: c.text },
  labelOn: { color: c.accent, fontWeight: '600' },
  detail: { ...textStyle(type.footnote), color: c.text2 },
  empty: { ...textStyle(type.callout), color: c.text3, padding: spacing.lg },
});
