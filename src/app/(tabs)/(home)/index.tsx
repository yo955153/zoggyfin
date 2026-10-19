import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { queryKeys } from '@/api/query-keys';
import { useApi } from '@/api/use-api';
import { Avatar } from '@/components/avatar';
import { registerBuiltinHomeSections } from '@/features/home/builtin-sections';
import { rootScreenOptions } from '@/lib/stack-options';
import { homeSections } from '@/registry/home-sections';
import { colors, size, spacing } from '@/theme';

registerBuiltinHomeSections();

export default function HomeScreen() {
  const { session, scope } = useApi();
  const qc = useQueryClient();
  const sections = useSyncExternalStore(homeSections.subscribe, homeSections.list, homeSections.list);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: queryKeys.all(scope) });
    setRefreshing(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          ...rootScreenOptions,
          title: 'Home',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/(tabs)/(home)/settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings and account"
              hitSlop={8}>
              <Avatar session={session} size={size.avatarSmall} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textSecondary} />}>
        {sections.map((s) => (
          <View key={s.id}>
            <s.component />
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxl * 2, paddingTop: spacing.none },
});
