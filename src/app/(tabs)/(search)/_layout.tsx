import { Stack } from 'expo-router';

import { tvStackListeners } from '@/features/tv/focus';
import { useTabStackOptions } from '@/lib/stack-options';
import { SidebarInsetProvider } from '@/theme/sidebar-inset';

/** Each tab root has its own path, so web URLs stay unique (only Home owns "/"). */
export const unstable_settings = { anchor: 'search' };

export default function SearchLayout() {
  return <SidebarInsetProvider>{(inset) => <TabStack inset={inset} />}</SidebarInsetProvider>;
}

function TabStack({ inset }: { inset: number }) {
  const options = useTabStackOptions(inset);
  return <Stack screenOptions={options} screenListeners={tvStackListeners} />;
}
