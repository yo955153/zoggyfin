import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isTV } from '@/platform/tv';
import { usePlayerStore } from '@/player/store';
import { roomLabel } from '@/together/hub';
import { useTogetherStore } from '@/together/store';
import { spacing } from '@/theme';

/** iOS 26 has the tab bar bottom accessory slot; elsewhere the mini player floats. */
export const HAS_ACCESSORY = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

/** Native tab bar height, for the floating mini player on web, Android and older iOS. Material 3 bars are 80 dp. */
export const TAB_BAR_HEIGHT = Platform.OS === 'web' ? 68 : Platform.OS === 'android' ? 80 : 49;

/** Height of the floating mini player capsule (its row is 52 pt). */
export const FLOATING_MINI_HEIGHT = 52;

/** Height of the together room bar (it floats above the mini player and the tab bar). */
export const ROOM_BAR_HEIGHT = 40;

/** Height of the iOS 26 tab bar accessory (the mini player), with its gap. */
export const ACCESSORY_HEIGHT = 56;

export interface TabOverlapInput {
  os: typeof Platform.OS;
  tv: boolean;
  /** The safe-area bottom inset of the window. */
  safeBottom: number;
  /** The mini player floats over the content (not the iOS 26 accessory). */
  floatingMini: boolean;
  /** The scroll view uses contentInsetAdjustmentBehavior="automatic" (iOS adds the tab bar itself). */
  autoInset: boolean;
  /** The together room bar shows (it floats over the content on every platform). */
  roomBar?: boolean;
}

/**
 * The height that the tab bar and the floating mini player take over the
 * bottom of a tab screen's content, which the content must not hide under.
 *
 * - Android: the tab screen already ends above the bar (automatic content
 *   insets are on), so only the mini player counts.
 * - iOS: a scroll view with automatic insets already clears the bar.
 * - Web (and the Mac app): the bar floats 16 px over the content.
 */
export function tabBarOverlap({ os, tv, safeBottom, floatingMini, autoInset, roomBar = false }: TabOverlapInput): number {
  if (tv) return 0;
  const mini = (floatingMini ? FLOATING_MINI_HEIGHT + spacing.sm : 0) + (roomBar ? ROOM_BAR_HEIGHT + spacing.sm : 0);
  if (os === 'android') return mini;
  if (os === 'web') return Math.max(16, safeBottom) + 52 + mini;
  return (autoInset ? 0 : safeBottom + TAB_BAR_HEIGHT) + mini;
}

/** See tabBarOverlap. `autoInset`: the scroll view has contentInsetAdjustmentBehavior="automatic". */
export function useTabBarOverlap({ autoInset = true }: { autoInset?: boolean } = {}): number {
  const safeBottom = useSafeAreaInsets().bottom;
  const miniVisible = usePlayerStore((s) => !!s.now && s.presentation === 'mini');
  const roomBar = useTogetherStore((s) => roomLabel(s) !== null);
  return tabBarOverlap({ os: Platform.OS, tv: isTV, safeBottom, floatingMini: miniVisible && !HAS_ACCESSORY, autoInset, roomBar });
}

/** Bottom padding for a tab screen's scroll content: `base` space below the last row, clear of the bars. */
export function useTabBottomPadding(base: number = spacing.huge * 2, opts?: { autoInset?: boolean }): number {
  return base + useTabBarOverlap(opts);
}
