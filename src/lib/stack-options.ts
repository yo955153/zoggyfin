import type { NativeStackNavigationOptions } from 'expo-router/native-stack';
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { isTV } from '@/platform/tv';
import { type AppTheme, font, fontFamily, type, useLayout, useTheme } from '@/theme';

/** Native stack options for a tab stack, in the active scheme. */
export function stackOptionsFor({ c }: AppTheme): NativeStackNavigationOptions {
  return {
    headerTintColor: c.accent,
    headerTitleStyle: { color: c.text, fontWeight: font(type.headline).fontWeight },
    headerLargeTitleShadowVisible: false,
    headerShadowVisible: false,
    headerTransparent: false,
    headerStyle: { backgroundColor: c.bg },
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: c.bg },
    // TV: the rail is the navigation; no header bar. Web keeps a slim header.
    headerShown: !isTV,
    ...(Platform.OS === 'web' ? { animation: 'none' as const } : null),
  };
}

export function useStackOptions(): NativeStackNavigationOptions {
  const t = useTheme();
  return useMemo(() => stackOptionsFor(t), [t]);
}

/**
 * Options for a tab stack. On iPad the content starts after a visible
 * sidebar (`inset`), so nothing sits under it.
 */
export function useTabStackOptions(inset: number): NativeStackNavigationOptions {
  const base = useStackOptions();
  return useMemo(
    () => (inset > 0 ? { ...base, contentStyle: [base.contentStyle, { paddingLeft: inset }] } : base),
    [base, inset],
  );
}

/** For a tab's first screen: a large title, like the iOS apps. */
export function useRootScreenOptions(): NativeStackNavigationOptions {
  const { c } = useTheme();
  const { gutter } = useLayout();
  return useMemo(
    () => ({
      headerLargeTitleEnabled: true,
      headerLargeTitleStyle: { color: c.text },
      headerLargeStyle: { backgroundColor: c.bg },
      // Web has no large titles: a large left-aligned title in the bar instead.
      ...(Platform.OS === 'web'
        ? {
            headerTitleAlign: 'left' as const,
            headerTitleStyle: { color: c.text, fontSize: type.largeTitle.fontSize, fontWeight: type.largeTitle.fontWeight, fontFamily: fontFamily.web },
            // The web header (React Navigation elements) takes these; the native-stack types do not list them.
            ...({
              headerTitleContainerStyle: { marginLeft: gutter },
              headerRightContainerStyle: { paddingRight: gutter },
            } as NativeStackNavigationOptions),
          }
        : null),
    }),
    [c, gutter],
  );
}

/** Detail pages draw their own hero under a transparent header. */
export const detailScreenOptions: NativeStackNavigationOptions = {
  headerTransparent: true,
  headerTitle: '',
  headerStyle: { backgroundColor: 'transparent' },
  // iOS 26 dims content under a transparent bar. The hero has its own top scrim.
  scrollEdgeEffects: { top: 'hidden' },
};
