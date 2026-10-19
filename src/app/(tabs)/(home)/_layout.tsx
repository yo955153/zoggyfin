import { Stack } from 'expo-router';

import { useStackOptions } from '@/lib/stack-options';

export const unstable_settings = { anchor: 'index' };

export default function HomeLayout() {
  const options = useStackOptions();
  return <Stack screenOptions={options} />;
}
