import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer, useMiniPlayerVisible } from '@/features/player/mini-player';
import { useStackOptions } from '@/lib/stack-options';
import { spacing, useLayout } from '@/theme';

/**
 * Downloads with no account signed in (from the sign-in screen). Everything
 * here plays from the device. The mini player floats at the bottom, as there
 * is no tab bar.
 */
export default function OfflineLayout() {
  const options = useStackOptions();
  const mini = useMiniPlayerVisible();
  const insets = useSafeAreaInsets();
  const l = useLayout();
  return (
    <View style={styles.flex}>
      <Stack screenOptions={options} />
      {mini ? (
        <View pointerEvents="box-none" style={[styles.floating, { bottom: insets.bottom + spacing.sm, left: l.gutter, right: l.gutter }]}>
          <MiniPlayer floating />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  floating: { position: 'absolute' },
});
