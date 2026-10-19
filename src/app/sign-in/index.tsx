import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/errors';
import { findServer } from '@/api/jellyfin';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { TextField } from '@/components/text-field';
import { loadRuntimeConfig } from '@/lib/runtime-config';
import { storage } from '@/storage/kv';
import { colors, iconSize, radius, size, spacing, type } from '@/theme';

const LAST_SERVER_KEY = 'server.lastUrl';

export default function ServerScreen() {
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
          <View style={styles.logo}>
            <Icon name="play.fill" size={iconSize.hero} color={colors.accentText} />
          </View>
          <Text style={styles.title}>Zoggyfin</Text>
          <Text style={styles.subtitle}>Connect to your Jellyfin server.</Text>
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
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  inner: { width: '100%', maxWidth: size.formMaxWidth, alignSelf: 'center', gap: spacing.lg },
  logo: {
    width: size.logo,
    height: size.logo,
    borderRadius: radius.logo,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: { ...type.largeTitle, color: colors.text, textAlign: 'center' },
  subtitle: { ...type.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  error: { ...type.callout, color: colors.danger },
});
