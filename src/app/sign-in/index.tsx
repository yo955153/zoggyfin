import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import LOGO from '@/assets/images/logo-mark.png';
import { describeError } from '@/api/errors';
import { findServer } from '@/api/jellyfin';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { loadRuntimeConfig } from '@/lib/runtime-config';
import { storage } from '@/storage/kv';
import { createStyles, type AppTheme, font, scaled, sizes, spacing, type, useStyles } from '@/theme';

const LAST_SERVER_KEY = 'server.lastUrl';

export default function ServerScreen() {
  const styles = useStyles(makeStyles);
  const [address, setAddress] = useState(() => storage.getString(LAST_SERVER_KEY) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (address) return;
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
    setBusy(true);
    setError(null);
    try {
      const { url, info } = await findServer(address);
      storage.set(LAST_SERVER_KEY, url);
      router.push({
        pathname: '/sign-in/login',
        params: { url, serverId: info.Id ?? '', serverName: info.ServerName ?? 'Jellyfin', version: info.Version ?? '' },
      });
    } catch (e) {
      const d = describeError(e);
      setError(d.kind === 'unknown' ? d.message : `${d.title}. ${d.message}`);
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
          <Text style={styles.subtitle}>Enter your server address.</Text>
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
        </View>
      </ScrollView>
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
}));
