import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { setAdminFixtures } from '@/features/admin/fixture-mode';
import { AdminHomeScreen } from '@/features/admin/screens';

/** Settings → Admin: the Admin panel of one server. */
export default function AdminRoute() {
  const { serverId, fixtures } = useLocalSearchParams<{ serverId: string; fixtures?: string }>();
  // Development builds: `?fixtures=1` (or 0) turns the made-up admin data on (or off), for simulators.
  useEffect(() => {
    if (__DEV__ && (fixtures === '1' || fixtures === '0')) setAdminFixtures(fixtures === '1');
  }, [fixtures]);
  return <AdminHomeScreen serverId={serverId} />;
}
