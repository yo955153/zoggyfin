import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { setUnauthorizedHandler } from '@/api/client';
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE,
  clearQueryCache,
  queryClient,
  queryPersister,
  shouldPersistQuery,
} from '@/api/query-client';
import { useSession, useSessionStore } from '@/auth/session-store';
import { ToastHost } from '@/components/toast-host';
import { toast } from '@/lib/toast';
import { audioSession } from '@/player/audio/session';
import { mediaColors, useTheme } from '@/theme';
import { AppThemeProvider } from '@/theme/provider';

export default function RootLayout() {
  const session = useSession();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!useSessionStore.getState().session) return;
      useSessionStore.getState().signOut();
      clearQueryCache();
      toast('Your session ended. Sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: CACHE_MAX_AGE,
          buster: CACHE_BUSTER,
          dehydrateOptions: {
            // Keep data even when its last refetch failed (offline), or the cache
            // would lose exactly what an offline cold start needs.
            shouldDehydrateQuery: (q) => q.state.data !== undefined && shouldPersistQuery(q.queryKey),
          },
        }}>
        <AppThemeProvider>
          <Root session={!!session} />
        </AppThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function Root({ session }: { session: boolean }) {
  const { c } = useTheme();
  // Bring back the last audio queue (paused) after a restart.
  useEffect(() => {
    if (session) audioSession().restore();
  }, [session]);
  return (
          <View style={[styles.flex, { backgroundColor: c.bg }]}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
              <Stack.Protected guard={session}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="player"
                  options={{
                    presentation: 'transparentModal',
                    animation: 'fade',
                    animationDuration: 240,
                    contentStyle: { backgroundColor: mediaColors.black },
                    autoHideHomeIndicator: true,
                    orientation: 'default',
                    gestureEnabled: false,
                  }}
                />
                <Stack.Screen
                  name="now-playing"
                  options={{
                    presentation: 'transparentModal',
                    animation: 'slide_from_bottom',
                    animationDuration: 300,
                    contentStyle: { backgroundColor: mediaColors.black },
                    gestureEnabled: false,
                  }}
                />
              </Stack.Protected>
              <Stack.Protected guard={!session}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
            </Stack>
            <ToastHost />
          </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
