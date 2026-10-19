import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/icon';

import { c, iconSize, player } from './tokens';

interface WebKitVideo extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
}

function airPlayVideo(): WebKitVideo | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (!('WebKitPlaybackTargetAvailabilityEvent' in window)) return null;
  const v = document.querySelector('video') as WebKitVideo | null;
  return v && typeof v.webkitShowPlaybackTargetPicker === 'function' ? v : null;
}

/** Web: Safari's AirPlay picker when the browser has one; nothing elsewhere. */
export function AirPlayButton({ onOpen }: { onOpen?: () => void }) {
  if (!airPlayVideo()) return null;
  return (
    <Pressable
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="AirPlay"
      onPress={() => {
        onOpen?.();
        airPlayVideo()?.webkitShowPlaybackTargetPicker?.();
      }}>
      <Icon name="airplay.video" size={iconSize.md} color={c.textOnMedia} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: player.pillButton, height: player.pillButton, alignItems: 'center', justifyContent: 'center' },
});
