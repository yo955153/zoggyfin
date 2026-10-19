import { router, Stack } from 'expo-router';
import { Text } from 'react-native';

import { Touchable } from '@/components/touchable';
import { font, type, useTheme } from '@/theme';

/** Add a server or a user while signed in: the sign-in screens in a sheet over the app. */
export default function AddAccountLayout() {
  const { c } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerTitle: '',
        headerTintColor: c.accent,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.bg },
        headerRight: () => (
          <Touchable onPress={() => router.dismissTo('/(tabs)/(home)')} hitSlop={10} radius={8} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={{ ...font(type.body), color: c.accent }}>Cancel</Text>
          </Touchable>
        ),
      }}
    />
  );
}
