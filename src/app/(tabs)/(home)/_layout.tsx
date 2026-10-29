import { Stack } from 'expo-router';

import { tvStackListeners } from '@/features/tv/focus';
import { useTabStackOptions } from '@/lib/stack-options';
import { SidebarInsetProvider } from '@/theme/sidebar-inset';

export const unstable_settings = { anchor: 'index' };

export default function HomeLayout() {
  return <SidebarInsetProvider>{(inset) => <TabStack inset={inset} />}</SidebarInsetProvider>;
}

function TabStack({ inset }: { inset: number }) {
  const options = useTabStackOptions(inset);
  return <Stack screenOptions={options} screenListeners={tvStackListeners} />;
}
