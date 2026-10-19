import type { NativeStackNavigationOptions } from 'expo-router/native-stack';

import { colors } from '@/theme';

export const stackOptions: NativeStackNavigationOptions = {
  headerTintColor: colors.text,
  headerLargeTitleShadowVisible: false,
  headerShadowVisible: false,
  headerTransparent: false,
  headerStyle: { backgroundColor: colors.background },
  headerBackButtonDisplayMode: 'minimal',
  contentStyle: { backgroundColor: colors.background },
};

/** For a tab's first screen: a large title, like the iOS apps. */
export const rootScreenOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerLargeTitleStyle: { color: colors.text },
};

/** Detail pages draw their own hero under a transparent header. */
export const detailScreenOptions: NativeStackNavigationOptions = {
  headerTransparent: true,
  headerTitle: '',
  headerStyle: { backgroundColor: 'transparent' },
};
