import { useLocalSearchParams } from 'expo-router';

import { AdminLogScreen } from '@/features/admin/screens';

/** Admin → Logs → one log file. */
export default function AdminLogRoute() {
  const { serverId, name } = useLocalSearchParams<{ serverId: string; name: string }>();
  return <AdminLogScreen serverId={serverId} name={name ?? ''} />;
}
