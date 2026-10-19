import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '@/components/states';
import { isAdminSection } from '@/features/admin/nav';
import { AdminSectionScreen } from '@/features/admin/screens';

/** One section of the Admin panel: sessions, users, libraries, tasks, activity, devices or logs. */
export default function AdminSectionRoute() {
  const { serverId, section } = useLocalSearchParams<{ serverId: string; section: string }>();
  if (!isAdminSection(section)) return <EmptyState icon="checkmark.shield" title="This page does not exist" />;
  return <AdminSectionScreen serverId={serverId} section={section} />;
}
