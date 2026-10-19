import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import LOGO from '@/assets/images/logo-mark.png';
import { describeError } from '@/api/errors';
import { findServer } from '@/api/jellyfin';
import { useAccounts } from '@/auth/session-store';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { setNoAccountOpen, useOfflineEntries } from '@/features/offline/use-offline-entries';
import { TogetherSheetHost } from '@/features/together/together-sheet';
import { loadRuntimeConfig } from '@/lib/runtime-config';
import { pageIsHttps } from '@/servers/connection';
import { MIXED_CONTENT_TEXT } from '@/servers/status';
import { storage } from '@/storage/kv';
import { openTogetherSheet } from '@/together/store';
import { createStyles, type AppTheme, font, scaled, sizes, spacing, type, useStyles } from '@/theme';

const LAST_SERVER_KEY = 'server.lastUrl';

/**
 * The server address step. The same screen adds a server while signed in
 * (`/add-account`, a sheet over the app) and signs in when signed out.
 */
export default function ServerScreen() {
  const styles = useStyles(makeStyles);
  const adding = usePathname().startsWith('/add-account');
  const saved = useAccounts().servers.length > 0;
  const entries = useOfflineEntries();
  // Opens the players and the offline Downloads for use with no account.
  useEffect(() => {
    if (!adding) setNoAccountOpen(true);
  }, [adding]);
  const [address, setAddress] = useState(() => (adding ? '' : (storage.getString(LAST_SERVER_KEY) ?? '')));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The preset of a self-hosted web build is for the first server only.
    if (address || adding || saved) return;
    let live = true;
    loadRuntimeConfig().then((c) => {
      if (live && c.defaultServerUrl) setAddress((a) => a || (c.defaultServerUrl ?? ''));
    });
    return () => {
      live = false;
    };
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setError(null);
    if (pageIsHttps() && /^http:\/\//i.test(address.trim())) {
      setError(MIXED_CONTENT_TEXT);
      return;
    }
    setBusy(true);
    try {
      const { url, info } = await findServer(address);
      storage.set(LAST_SERVER_KEY, url);
      router.push({
        pathname: adding ? '/add-account/login' : '/sign-in/login',
        params: { url, serverId: info.Id ?? '', serverName: info.ServerName ?? 'Jellyfin', version: info.Version ?? '' },
      });
    } catch (e) {
      const d = describeError(e);
      if (pageIsHttps() && d.kind === 'offline' && !/^https:\/\//i.test(address.trim())) setError(`${d.title}. ${MIXED_CONTENT_TEXT}`);
      else setError(d.kind === 'unknown' ? d.message : `${d.title}. ${d.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" accessibilityIgnoresInvertColors accessible={false} />
          <Text style={styles.title} accessibilityRole="header">
            zoggyfin
          </Text>
          <Text style={styles.subtitle}>{adding ? 'Enter the address of the server to add.' : 'Enter your server address.'}</Text>
          <TextField
            label="Server address"
            value={address}
            onChangeText={setAddress}
            placeholder="https://jellyfin.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            clearButtonMode="while-editing"
            returnKeyType="go"
            onSubmitEditing={connect}
            accessibilityLabel="Server address"
          />
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button title="Continue" onPress={connect} loading={busy} disabled={!address.trim()} />
          <Text style={styles.footnote}>Zoggyfin is a client for Jellyfin. It connects only to the server you enter.</Text>
          {/* Downloads and nearby watch together need no account and no server (for example on a plane). */}
          {!adding && (entries.downloads || entries.joinNearby) ? (
            <View style={styles.nearby}>
              <Text style={styles.or}>No server here?</Text>
              {entries.downloads ? (
                <Button
                  title={`Downloads · ${entries.count}`}
                  variant="tonal"
                  icon="arrow.down.circle"
                  onPress={() => router.push('/offline')}
                />
              ) : null}
              {entries.joinNearby ? (
                <Button title="Join a nearby session" variant="tonal" icon="antenna.radiowaves.left.and.right" onPress={() => openTogetherSheet('join', null)} />
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {entries.joinNearby && !adding ? <TogetherSheetHost where="join" /> : null}
    </KeyboardAvoidingView>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bg },
  content: { flexGrow: 1, justifyContent: 'center' as const, padding: spacing.xxl },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.formMaxWidth), alignSelf: 'center' as const, gap: spacing.lg },
  logo: { width: scaled(sizes.logoMark), height: scaled(sizes.logoMark), alignSelf: 'center' as const },
  title: { ...font(type.largeTitle), fontWeight: '600' as const, letterSpacing: -0.34, color: c.text, textAlign: 'center' as const },
  subtitle: { ...font(type.body), color: c.text2, textAlign: 'center' as const, marginBottom: spacing.md, marginTop: -spacing.sm },
  error: { ...font(type.footnote), color: c.danger },
  footnote: { ...font(type.footnote), color: c.text3, textAlign: 'center' as const, marginTop: spacing.sm },
  nearby: { gap: spacing.sm, marginTop: spacing.xl },
  or: { ...font(type.footnote), color: c.text2, textAlign: 'center' as const },
}));
