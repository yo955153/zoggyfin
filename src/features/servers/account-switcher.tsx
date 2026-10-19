/**
 * The account switcher: the sheet behind the avatar button in the Home
 * header. Every saved server with its users; one tap on a user switches to
 * that server and user.
 */
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { startUrl } from '@/auth/accounts';
import { useAccounts, useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import { createStyles, type AppTheme, font, iconSize, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import { openAddServer, openAddUser, switchAccount } from './actions';
import { ConnectionStatus } from './connection-status';

export function AccountSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const sheet = useStyles(makeSheetStyles);
  const { c } = useTheme();
  const { servers } = useAccounts();
  const session = useSession();
  const close = (then?: () => void) => {
    onClose();
    // Let the sheet leave before the next screen comes in.
    if (then) setTimeout(then, 180);
  };

  return (
    <Sheet visible={visible} title="Accounts" onClose={onClose} doneLabel="Done">
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {session ? (
          <View style={sheet.group}>
            <ConnectionStatus serverId={session.serverId} inset={false} />
          </View>
        ) : null}
        {servers.map((sv) => {
          const url = session?.serverId === sv.id ? session.serverUrl : (startUrl(sv) ?? '');
          return (
            <View key={sv.id} style={s.section}>
              <Text style={s.title} accessibilityRole="header" numberOfLines={1}>
                {sv.name.toUpperCase()}
              </Text>
              <View style={sheet.group}>
                {sv.users.map((u) => {
                  const active = session?.serverId === sv.id && session.userId === u.userId;
                  return (
                    <SheetRow
                      key={u.userId}
                      onPress={() => close(() => switchAccount({ serverId: sv.id, userId: u.userId }))}
                      accessibilityRole="radio"
                      checked={active}
                      accessibilityLabel={`${u.userName} on ${sv.name}`}>
                      <Avatar session={{ serverId: sv.id, serverUrl: url, userId: u.userId, userName: u.userName, userImageTag: u.userImageTag, token: null }} size={scaled(30)} />
                      <Text style={sheet.rowText} numberOfLines={1}>
                        {u.userName}
                      </Text>
                      {active ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
                    </SheetRow>
                  );
                })}
                <SheetRow onPress={() => close(() => openAddUser(sv.id))} last accessibilityLabel={`Add user on ${sv.name}`}>
                  <View style={s.plus}>
                    <Icon name="person.badge.plus" size={scaled(iconSize.sm)} color={c.accent} />
                  </View>
                  <Text style={[sheet.rowText, s.link]}>Add user</Text>
                </SheetRow>
              </View>
            </View>
          );
        })}
        <View style={sheet.group}>
          <SheetRow onPress={() => close(openAddServer)}>
            <Icon name="plus" size={scaled(iconSize.sm)} color={c.accent} />
            <Text style={[sheet.rowText, s.link]}>Add server</Text>
          </SheetRow>
          <SheetRow onPress={() => close(() => router.push('/(tabs)/(home)/settings'))} last>
            <Icon name="gearshape" size={scaled(iconSize.sm)} color={c.text2} />
            <Text style={sheet.rowText}>Settings</Text>
          </SheetRow>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  scroll: { maxHeight: 560 },
  content: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  section: { gap: spacing.sm - 2 },
  title: { ...font(type.footnote), letterSpacing: 0.4, color: c.text2, marginLeft: spacing.lg },
  plus: { width: scaled(30), alignItems: 'center' as const },
  link: { color: c.accent },
}));
