import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Touchable } from '@/components/touchable';
import { createStyles, type AppTheme, font, sizes, spacing, type, useStyles } from '@/theme';

/** The header of an extension screen shown over the app: a title and a "Done" button. */
export function ModalHeader({ title, onClose, closeLabel = 'Done', modal = true }: { title: string; onClose: () => void; closeLabel?: string; modal?: boolean }) {
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // A page sheet on iOS starts under the status bar; a full screen does not.
  return (
    <View style={[s.bar, { paddingTop: (modal ? spacing.sm : insets.top) + spacing.xs }]}>
      <Text style={s.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <Touchable onPress={onClose} hitSlop={10} radius={8} accessibilityRole="button" accessibilityLabel={closeLabel}>
        <Text style={s.close}>{closeLabel}</Text>
      </Touchable>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  bar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    minHeight: sizes.settingsRow,
    borderBottomWidth: sizes.hairline,
    borderBottomColor: c.separator,
    backgroundColor: c.bgGrouped,
  },
  title: { ...font(type.headline), color: c.text, flex: 1 },
  close: { ...font(type.headline), color: c.accent },
}));
