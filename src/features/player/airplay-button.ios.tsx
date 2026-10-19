import { VideoAirPlayButton } from 'expo-video';
import { StyleSheet } from 'react-native';

import { c, player } from './tokens';

/** The system AirPlay route picker. */
export function AirPlayButton({ onOpen }: { onOpen?: () => void }) {
  return (
    <VideoAirPlayButton
      style={styles.button}
      tint={c.textOnMedia}
      activeTint={c.accent}
      prioritizeVideoDevices
      onBeginPresentingRoutes={onOpen}
      accessibilityLabel="AirPlay"
    />
  );
}

const styles = StyleSheet.create({ button: { width: player.pillButton, height: player.pillButton } });
