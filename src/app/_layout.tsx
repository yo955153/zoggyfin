import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { setUnauthorizedHandler } from '@/api/client';
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE,
  dropOtherScopes,
  inScope,
  persisterFor,
  queryClient,
  shouldPersistQuery,
} from '@/api/query-client';
import { useSession, useSessionStore } from '@/auth/session-store';
import { ToastHost } from '@/components/toast-host';
import { downloads, downloadsSupported } from '@/downloads';
import { setNoAccountOpen, useNoAccountStore } from '@/features/offline/use-offline-entries';
import { AddToPlaylistHost } from '@/features/playlists/add-to-playlist';
import { UpdateCardHost } from '@/features/updates/update-card';
import { startOfflineServices } from '@/features/offline/bootstrap';
import { toast } from '@/lib/toast';
import { startUpdateChecks } from '@/platform/updates';
import { audioSession } from '@/player/audio/session';
import { mediaColors, useTheme } from '@/theme';
import { AppThemeProvider } from '@/theme/provider';

export default function RootLayout() {
  const session = useSession();
  // Each account has its own persisted cache. A switch mounts the provider again,
  // so it restores the new account's cache and saves only that account's queries.
  const serverId = session?.serverId;
  const userId = session?.userId;
  const scope = useMemo(() => (serverId && userId ? { serverId, userId } : null), [serverId, userId]);
  const scopeId = scope ? `${scope.serverId}.${scope.userId}` : 'none';

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const s = useSessionStore.getState().session;
      if (!s) return;
      useSessionStore.getState().signOut();
      toast(`Your session on ${s.serverName} ended. Sign in again.`);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <PersistQueryClientProvider
        key={scopeId}
        client={queryClient}
        onSuccess={() => dropOtherScopes(scope)}
        persistOptions={{
          persister: persisterFor(scope),
          maxAge: CACHE_MAX_AGE,
          buster: CACHE_BUSTER,
          dehydrateOptions: {
            // Keep data even when its last refetch failed (offline), or the cache
            // would lose exactly what an offline cold start needs.
            shouldDehydrateQuery: (q) => q.state.data !== undefined && inScope(q.queryKey, scope) && shouldPersistQuery(q.queryKey),
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
  const noAccount = useNoAccountStore((st) => st.open) && !session;
  useEffect(() => {
    if (session) setNoAccountOpen(false);
  }, [session]);
  // Downloads play with no account (see features/offline/entries.ts): the files are found at start, signed in or not.
  useEffect(() => {
    if (downloadsSupported) void downloads.init();
  }, []);
  // Desktop app only: look for a new version soon after start and every few hours.
  useEffect(() => startUpdateChecks(), []);
  // Bring back the last audio queue (paused) after a restart.
  useEffect(() => {
    if (!session) return;
    startOfflineServices();
    audioSession().restore();
  }, [session]);
  return (
          <View style={[styles.flex, { backgroundColor: c.bg }]}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
              <Stack.Protected guard={session}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="add-account" options={{ presentation: 'modal' }} />
              </Stack.Protected>
              <Stack.Protected guard={!session}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
              {/* The players and the offline Downloads also open with no account: downloads and nearby sessions need no sign-in. */}
              <Stack.Protected guard={session || noAccount}>
                <Stack.Screen
                  name="player"
                  options={{
                    presentation: 'transparentModal',
                    animation: 'fade',
                    animationDuration: 240,
                    contentStyle: { backgroundColor: mediaColors.black },
                    autoHideHomeIndicator: true,
                    // Android: the video uses the whole screen; a swipe from the edge shows the system bar.
                    navigationBarHidden: true,
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
                <Stack.Screen name="offline" />
              </Stack.Protected>
            </Stack>
            {session ? <AddToPlaylistHost /> : null}
            <UpdateCardHost />
            <ToastHost />
          </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
