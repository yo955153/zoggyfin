import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
import { colors } from '@/theme';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    primary: colors.accent,
    border: colors.separator,
  },
};

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
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <View style={styles.flex}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Protected guard={!!session}>
                <Stack.Screen name="(tabs)" />
              </Stack.Protected>
              <Stack.Protected guard={!session}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
            </Stack>
            <ToastHost />
          </View>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: colors.background } });
