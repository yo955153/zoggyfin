/**
 * Props for a ScrollView (or FlashList) whose scroll the app drives on
 * Android TV: Home, its rows and the item grids scroll to the focused row or
 * tile with `scrollTo`.
 *
 * Android's own focus scroll ran as well. It jumped at once to show the
 * focused view and the animated `scrollTo` then moved again, so each D-pad
 * press jumped and slid. With no focus target left (Down on the last row) it
 * scrolled past the end and cut the rows off. `scrollEnabled: false` turns
 * both off on Android: the D-pad still moves the focus, and `scrollTo` still
 * scrolls. The animation is shorter than the default (250 ms) and slows down
 * at the end, so fast presses do not queue up behind it.
 *
 * Off on the web TV preview and on tvOS, where the focus engine owns the scroll.
 */
import { Platform } from 'react-native';

import { isNativeTV } from '@/platform/tv';

const driven = isNativeTV && Platform.OS === 'android';

export const tvDrivenScroll = driven
  ? ({ scrollEnabled: false, scrollAnimationDuration: 180, scrollAnimationEasing: 'ease-out' } as const)
  : {};
