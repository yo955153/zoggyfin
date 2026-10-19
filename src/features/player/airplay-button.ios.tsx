import { VideoAirPlayButton } from 'expo-video';
import { StyleSheet } from 'react-native';

import { c, player } from './tokens';

/** The system AirPlay route picker. `audio` lists speakers first instead of TVs. */
export function AirPlayButton({ onOpen, audio = false }: { onOpen?: () => void; audio?: boolean }) {
  return (
    <VideoAirPlayButton
      style={styles.button}
      tint={c.textOnMedia}
      activeTint={c.accent}
      prioritizeVideoDevices={!audio}
      onBeginPresentingRoutes={onOpen}
      accessibilityLabel="AirPlay"
    />
  );
}

const styles = StyleSheet.create({ button: { width: player.pillButton, height: player.pillButton } });
