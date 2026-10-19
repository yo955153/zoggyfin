import { Stack } from 'expo-router';

import { stackOptions } from '@/lib/stack-options';

export const unstable_settings = { anchor: 'index' };

export default function HomeLayout() {
  return <Stack screenOptions={stackOptions} />;
}
