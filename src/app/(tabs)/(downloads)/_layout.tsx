import { Stack } from 'expo-router';

import { stackOptions } from '@/lib/stack-options';

/** Each tab root has its own path, so web URLs stay unique (only Home owns "/"). */
export const unstable_settings = { anchor: 'downloads' };

export default function DownloadsLayout() {
  return <Stack screenOptions={stackOptions} />;
}
