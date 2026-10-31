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
 * that spot for a view inside the screen. Screens with a plain header and
 * the headerless tab root pages use the same host, so the spinner looks the
 * same on every page (`useRefreshSpinner(…, headerless)` sets its height).
 */
export const ownRefreshSpinner = Platform.OS === 'ios' && Number(Platform.Version) >= 26;

/** The spinner centre below the top safe-area edge, where UIKit puts its own under a header bar (iOS 26). */
const SPINNER_CENTER = 84;
/** The same with no header (a tab's root page, `useRootScreenOptions`): the list starts at the safe-area edge. */
const SPINNER_CENTER_HEADERLESS = 32;
const SPINNER_SIZE = 20;

/** The running refreshes, newest last (each one's spinner centre). */
let running: number[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getRunning = () => running;
function change(next: number[]) {
  running = next;
  listeners.forEach((l) => l());
}

/** The tint for a RefreshControl on a large-title screen: none where the root host draws the spinner. */
export function refreshTint(color: string): string {
  return ownRefreshSpinner ? 'transparent' : color;
}

/**
 * Shows the root spinner while this screen's pull to refresh runs.
 * `headerless`: the screen has no header bar (a tab's root page with
 * `useRootScreenOptions()`), so the spinner sits just under the status bar.
 */
export function useRefreshSpinner(refreshing: boolean, headerless = false): void {
  useEffect(() => {
    if (!ownRefreshSpinner || !refreshing) return;
    const center = headerless ? SPINNER_CENTER_HEADERLESS : SPINNER_CENTER;
    change([...running, center]);
    return () => {
      const i = running.lastIndexOf(center);
      change(i < 0 ? running : [...running.slice(0, i), ...running.slice(i + 1)]);
    };
  }, [refreshing, headerless]);
}

/** The root layout mounts one host, after the navigation. */
export function RefreshSpinnerHost() {
  const list = useSyncExternalStore(subscribe, getRunning, getRunning);
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  if (list.length === 0) return null;
  const center = list[list.length - 1];
  return (
    <View pointerEvents="none" style={[s.box, { top: insets.top + center - SPINNER_SIZE / 2 }]}>
      <ActivityIndicator color={c.text2} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { position: 'absolute', left: 0, right: 0, height: SPINNER_SIZE, alignItems: 'center', justifyContent: 'center' },
});
