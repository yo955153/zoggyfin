import { Stack } from 'expo-router';

import { stackOptions } from '@/lib/stack-options';

/** Each tab root has its own path, so web URLs stay unique (only Home owns "/"). */
export const unstable_settings = { anchor: 'music' };

export default function MusicLayout() {
  return <Stack screenOptions={stackOptions} />;
}
