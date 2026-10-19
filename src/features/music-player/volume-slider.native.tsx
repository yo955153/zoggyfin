import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { type ComponentType } from 'react';
import { type ColorValue, StyleSheet, View, type ViewProps } from 'react-native';

import { Icon } from '@/components/icon';

import { c, iconSize, spacing } from '../player/tokens';

type NativeProps = ViewProps & { color?: ColorValue };

const available = requireOptionalNativeModule('ZoggyfinVolume') !== null;
const NativeVolume: ComponentType<NativeProps> | null = available ? requireNativeView<NativeProps>('ZoggyfinVolume') : null;

/** The system volume slider (MPVolumeView). An older build without the native view shows nothing. */
export function VolumeSlider() {
  if (!NativeVolume) return null;
  return (
    <View style={styles.row} accessibilityLabel="Volume">
      <Icon name="speaker.fill" size={iconSize.sm} color={c.textOnMediaSecondary} />
      <NativeVolume style={styles.slider} color={c.textOnMedia} />
      <Icon name="speaker.wave.3.fill" size={iconSize.sm} color={c.textOnMediaSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, height: 44 },
  slider: { flex: 1, height: 34 },
});
