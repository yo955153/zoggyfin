/** The "Invite someone" row on a server's page. It shows only for an administrator of that server. */
import { useQuery } from '@tanstack/react-query';
import { type Href, router } from 'expo-router';

import { useApi } from '@/api/use-api';
import { scopeKey } from '@/api/query-keys';
import { useSession } from '@/auth/session-store';
import { Group, SettingsRow } from '@/features/settings/rows';
import { isAdministrator } from '@/invite/api';

export function inviteAdminKey(scope: { serverId: string; userId: string }) {
  return [...scopeKey(scope), 'invite', 'admin'] as const;
}

export function InviteSection({ serverId }: { serverId: string }) {
  const session = useSession();
  if (!session || session.serverId !== serverId) return null;
  return <AdminOnly serverId={serverId} />;
}

function AdminOnly({ serverId }: { serverId: string }) {
  const { api, scope } = useApi();
  const admin = useQuery({ queryKey: inviteAdminKey(scope), queryFn: () => isAdministrator(api), staleTime: 60 * 1000 });
  if (admin.data !== true) return null;
  return (
    <Group footer="Add a person to this server and send them a link. They tap it, get the app and are signed in.">
      <SettingsRow icon="person.badge.plus" label="Invite someone" onPress={() => router.push(`/invite/${serverId}` as Href)} last />
    </Group>
  );
}
