import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

/**
 * iOS 26 draws the large title in its own view inside the scroll view, and
 * draws it again when a pull to refresh ends. The UIRefreshControl spinner
 * then disappears while the refresh still runs: it blinks. A screen with a
 * large title hides the native spinner (`refreshTint`) and reports its
 * refresh (`useRefreshSpinner`); the root host draws the spinner where UIKit
 * puts its own. The host is above the navigation, because the header covers
 * that spot for a view inside the screen.
 */
export const ownRefreshSpinner = Platform.OS === 'ios' && Number(Platform.Version) >= 26;

/** The spinner centre below the top safe-area edge, where UIKit puts its own (iOS 26). */
const SPINNER_CENTER = 84;
const SPINNER_SIZE = 20;

let running = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getRunning = () => running;
function change(by: number) {
  running += by;
  listeners.forEach((l) => l());
}

/** The tint for a RefreshControl on a large-title screen: none where the root host draws the spinner. */
export function refreshTint(color: string): string {
  return ownRefreshSpinner ? 'transparent' : color;
}

/** Shows the root spinner while this screen's pull to refresh runs. */
export function useRefreshSpinner(refreshing: boolean): void {
  useEffect(() => {
    if (!ownRefreshSpinner || !refreshing) return;
    change(1);
    return () => change(-1);
  }, [refreshing]);
}

/** The root layout mounts one host, after the navigation. */
export function RefreshSpinnerHost() {
  const count = useSyncExternalStore(subscribe, getRunning, getRunning);
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  if (count === 0) return null;
  return (
    <View pointerEvents="none" style={[s.box, { top: insets.top + SPINNER_CENTER - SPINNER_SIZE / 2 }]}>
      <ActivityIndicator color={c.text2} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { position: 'absolute', left: 0, right: 0, height: SPINNER_SIZE, alignItems: 'center', justifyContent: 'center' },
});
