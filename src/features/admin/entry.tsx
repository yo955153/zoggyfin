/**
 * The ways into the Admin panel from Settings: an "Admin" group with one row
 * per server where a saved account is an administrator, and a small shield
 * button on the server row. Development builds add the fixture switch.
 */
import { Platform, Switch, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { Group, SettingsRow, webSwitchColors } from '@/features/settings/rows';
import { isTV } from '@/platform/tv';
import { iconSize, mediaColors, scaled, useTheme } from '@/theme';

import { useAdminServers } from './access';
import { setAdminFixtures, useAdminFixtures } from './fixture-mode';
import { openAdmin } from './nav';

/** Settings → Admin. Nothing shows when no saved account is an administrator. */
export function AdminSettingsGroup() {
  const servers = useAdminServers();
  if (isTV || servers.length === 0) return null;
  const many = servers.length > 1;
  return (
    <Group title="Admin" footer="Sessions, users, libraries, scheduled tasks, logs and the server itself. Only for administrators.">
      {servers.map((sv, i) => (
        <SettingsRow
          key={sv.serverId}
          icon="checkmark.shield"
          label={many ? sv.serverName : 'Admin'}
          value={many ? undefined : sv.serverName}
          onPress={() => openAdmin(sv.serverId)}
          last={i === servers.length - 1}
        />
      ))}
    </Group>
  );
}

/** A shield on the server row of Settings → Servers, for administrators. It opens the Admin panel (native). */
export function AdminShieldButton({ serverId, serverName }: { serverId: string; serverName: string }) {
  const servers = useAdminServers();
  const { c } = useTheme();
  if (isTV || !servers.some((s) => s.serverId === serverId)) return null;
  // Web: a button must not be inside the row button (invalid HTML). The shield only marks the
  // server there; the Admin group below the servers opens the panel.
  if (Platform.OS === 'web') {
    return (
      <View accessible={false} style={{ padding: 4 }}>
        <Icon name="checkmark.shield" size={scaled(iconSize.sm)} color={c.accent} />
      </View>
    );
  }
  return (
    <Touchable
      kind="icon"
      radius={14}
      hitSlop={8}
      onPress={() => openAdmin(serverId)}
      accessibilityRole="button"
      accessibilityLabel={`Admin of ${serverName}`}
      style={{ padding: 4 }}>
      <Icon name="checkmark.shield" size={scaled(iconSize.sm)} color={c.accent} />
    </Touchable>
  );
}

/** Development builds only: show the Admin panel with made-up data. */
export function AdminFixturesGroup() {
  const on = useAdminFixtures();
  const { c } = useTheme();
  if (!__DEV__) return null;
  return (
    <Group footer="Every server shows the Admin panel with made-up data. No request goes to a server. Only in development builds.">
      <SettingsRow
        icon="checkmark.shield"
        label="Admin fixture data"
        onPress={() => setAdminFixtures(!on)}
        role="switch"
        checked={on}
        last
        trailing={<Switch value={on} onValueChange={setAdminFixtures} trackColor={{ true: c.accent, false: c.surface3 }} thumbColor={mediaColors.white} {...webSwitchColors} accessibilityLabel="Admin fixture data" />}
      />
    </Group>
  );
}
