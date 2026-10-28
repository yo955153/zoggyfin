import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { type ComponentRef, useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { queryKeys } from '@/api/query-keys';
import { useApi } from '@/api/use-api';
import { Avatar } from '@/components/avatar';
import { refreshTint, useRefreshSpinner } from '@/components/refresh-spinner';
import { Touchable } from '@/components/touchable';
import { registerBuiltinHomeSections } from '@/features/home/builtin-sections';
import { Billboard, BillboardRows } from '@/features/tv/billboard';
import type { FocusTarget } from '@/features/tv/focus';
import { TvRowScroll } from '@/features/tv/shelf';
import { ProfileMenu } from '@/features/profile/profile-menu';
import { OfflineBanner } from '@/features/offline/offline-banner';
import { HomeTogetherSheet, homeTogether, NearbyHomeCard, TogetherHeaderButton } from '@/features/together/home-entry';
import { useRootScreenOptions } from '@/lib/stack-options';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { isTV } from '@/platform/tv';
import { homeSections } from '@/registry/home-sections';
import { createStyles, type AppTheme, sizes, spacing, useLayout, useStyles, useTheme } from '@/theme';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

registerBuiltinHomeSections();

export default function HomeScreen() {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const l = useLayout();
  const root = useRootScreenOptions();
  const { session, scope } = useApi();
  const qc = useQueryClient();
  const sections = useSyncExternalStore(homeSections.subscribe, homeSections.list, homeSections.list);
  const [accounts, setAccounts] = useState(false);

  const pull = usePullRefresh(() => qc.invalidateQueries({ queryKey: queryKeys.all(scope) }));
  useRefreshSpinner(pull.refreshing);

  // TV: the row with the focus scrolls to the top of the list, right under the billboard.
  const tvScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const tvContent = useRef<ComponentRef<typeof View> | null>(null);
  const lastRowY = useRef(-1);
  const scrollToRow = useCallback((row: FocusTarget | null) => {
    const content = tvContent.current;
    if (!row || !content) return;
    row.measureLayout(
      content,
      (_x, y) => {
        if (Math.abs(y - lastRowY.current) < 1) return;
        lastRowY.current = y;
        tvScroll.current?.scrollTo({ y, animated: true });
      },
      () => undefined,
    );
  }, []);

  if (isTV) {
    // TV: the billboard for the focused item stays at the top; the rows scroll under it.
    return (
      <View style={s.flex}>
        <Billboard />
        <BillboardRows.Provider value>
          <TvRowScroll.Provider value={scrollToRow}>
            {/* The bottom padding lets the last row scroll up to the top too. */}
            <ScrollView ref={tvScroll} style={s.flex} contentContainerStyle={{ paddingBottom: Math.max(bottomPad, l.height * 0.5) }}>
              <View ref={tvContent}>
                <OfflineBanner entries />
                {sections.map((sec) => (
                  <View key={sec.id}>
                    <sec.component />
                  </View>
                ))}
              </View>
            </ScrollView>
          </TvRowScroll.Provider>
        </BillboardRows.Provider>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          ...root,
          title: 'Home',
          headerRight: () => (
            <View style={s.headerRow}>
              {homeTogether ? <TogetherHeaderButton /> : null}
              <Touchable
                onPress={() => setAccounts(true)}
                onLongPress={() => router.push('/(tabs)/(home)/settings')}
                radius={sizes.avatarSmall / 2}
                accessibilityRole="button"
                accessibilityLabel="Profile menu"
                accessibilityHint="Account, Together, Downloads, Settings and more"
                hitSlop={8}>
                <Avatar session={session} size={sizes.avatarSmall} />
              </Touchable>
            </View>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={s.flex}
        contentContainerStyle={[s.content, { paddingBottom: bottomPad }]}
        refreshControl={isTV ? undefined : <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text2)} />}>
        <OfflineBanner entries />
        {homeTogether ? <NearbyHomeCard /> : null}
        {sections.map((sec) => (
          <View key={sec.id}>
            <sec.component />
          </View>
        ))}
      </ScrollView>
      <ProfileMenu visible={accounts} onClose={() => setAccounts(false)} />
      {homeTogether ? <HomeTogetherSheet /> : null}
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bg },
  content: { paddingBottom: spacing.huge * 2 },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
}));
