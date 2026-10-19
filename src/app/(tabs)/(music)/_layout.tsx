import { Stack } from 'expo-router';

import { useStackOptions } from '@/lib/stack-options';

/** Each tab root has its own path, so web URLs stay unique (only Home owns "/"). */
export const unstable_settings = { anchor: 'music' };

export default function MusicLayout() {
  const options = useStackOptions();
  return <Stack screenOptions={options} />;
}
