import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { queryKeys } from '@/api/query-keys';
import { useApi } from '@/api/use-api';
import { Avatar } from '@/components/avatar';
import { Touchable } from '@/components/touchable';
import { registerBuiltinHomeSections } from '@/features/home/builtin-sections';
import { AccountSwitcher } from '@/features/servers/account-switcher';
import { OfflineBanner } from '@/features/offline/offline-banner';
import { useRootScreenOptions } from '@/lib/stack-options';
import { isTV } from '@/platform/tv';
import { homeSections } from '@/registry/home-sections';
import { createStyles, type AppTheme, sizes, spacing, useStyles, useTheme } from '@/theme';

registerBuiltinHomeSections();

export default function HomeScreen() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const root = useRootScreenOptions();
  const { session, scope } = useApi();
  const qc = useQueryClient();
  const sections = useSyncExternalStore(homeSections.subscribe, homeSections.list, homeSections.list);
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: queryKeys.all(scope) });
    setRefreshing(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          ...root,
          title: 'Home',
          headerRight: () => (
            <Touchable
              onPress={() => setAccounts(true)}
              onLongPress={() => router.push('/(tabs)/(home)/settings')}
              radius={sizes.avatarSmall / 2}
              accessibilityRole="button"
              accessibilityLabel="Accounts and settings"
              accessibilityHint="Switch server or user"
              hitSlop={8}>
              <Avatar session={session} size={sizes.avatarSmall} />
            </Touchable>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={s.flex}
        contentContainerStyle={s.content}
        refreshControl={isTV ? undefined : <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.text2} />}>
        <OfflineBanner entries />
        {sections.map((sec) => (
          <View key={sec.id}>
            <sec.component />
          </View>
        ))}
      </ScrollView>
      <AccountSwitcher visible={accounts} onClose={() => setAccounts(false)} />
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bg },
  content: { paddingBottom: spacing.huge * 2 },
}));
