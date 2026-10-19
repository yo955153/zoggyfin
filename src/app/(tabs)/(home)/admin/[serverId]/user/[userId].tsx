import { useLocalSearchParams } from 'expo-router';

import { AdminUserScreen } from '@/features/admin/screens';

/** Admin → Users → one user. */
export default function AdminUserRoute() {
  const { serverId, userId } = useLocalSearchParams<{ serverId: string; userId: string }>();
  return <AdminUserScreen serverId={serverId} userId={userId ?? ''} />;
}
