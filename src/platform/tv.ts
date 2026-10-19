/**
 * TV detection and the features each platform gets.
 *
 * `isTV` is true on Apple TV and Android TV builds (react-native-tvos sets
 * `Platform.isTV`). On web, `?tv=1` (kept for the browser tab) or the build
 * flag `EXPO_PUBLIC_TV_PREVIEW=1` turns on a TV preview: the TV layout,
 * navigated with the arrow keys. `?tv=0` turns the preview off again.
 */
import { Platform } from 'react-native';

const PREVIEW_KEY = 'zoggyfin:tvPreview';

function webPreview(): boolean {
  if (Platform.OS !== 'web') return false;
  if (process.env.EXPO_PUBLIC_TV_PREVIEW === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('tv');
    if (q === '1') window.sessionStorage.setItem(PREVIEW_KEY, '1');
    if (q === '0') window.sessionStorage.removeItem(PREVIEW_KEY);
    return window.sessionStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/** A real TV build. */
export const isNativeTV: boolean = Platform.isTV === true;

/** The TV layout is on: a real TV, or the web TV preview. */
export const isTV: boolean = isNativeTV || webPreview();

/** The web TV preview (arrow keys move the focus, Escape goes back). */
export const isTVPreview: boolean = isTV && !isNativeTV;

/**
 * What each platform shows. TV has no downloads, no watch together and no
 * extension web panels (design spec, Platforms). Web has no downloads.
 */
export const features = {
  downloads: !isTV && Platform.OS !== 'web',
  watchTogether: !isTV,
  extensionPanels: !isTV,
  touchGestures: !isTV,
} as const;
