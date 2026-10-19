import { useState } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { useOffline, useOnlineStore } from '@/lib/online';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

/**
 * The offline banner (design system §7.13), at the top of a tab's content
 * under the navigation bar. Dismissible; it comes back on the next change
 * to offline.
 */
export function OfflineBanner({ flush }: { flush?: boolean } = {}) {
  const offline = useOffline();
  const count = useOnlineStore((st) => st.offlineCount);
  const [dismissedAt, setDismissedAt] = useState(-1);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  if (!offline || dismissedAt === count) return null;
  return (
    <View style={[s.wrap, { marginHorizontal: flush ? 0 : l.gutter }]} accessibilityRole="alert" accessibilityLabel="Offline. Showing downloaded and cached items.">
      <Icon name="wifi.exclamationmark" size={scaled(iconSize.sm)} color={c.text2} />
      <Text style={s.text}>Offline. Showing downloaded and cached items.</Text>
      <Touchable onPress={() => setDismissedAt(count)} radius={12} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide this message">
        <Icon name="xmark" size={scaled(iconSize.xs)} color={c.text2} weight="semibold" />
      </Touchable>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    backgroundColor: c.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.sm,
    borderCurve: 'continuous' as const,
  },
  text: { ...font(type.footnote), color: c.text, flex: 1 },
}));
