import { Stack } from 'expo-router';

import { useTheme } from '@/theme';

export default function SignInLayout() {
  const { c } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerTitle: '',
        headerTintColor: c.accent,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.bg },
      }}
    />
  );
}
