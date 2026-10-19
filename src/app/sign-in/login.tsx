import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import {
  authenticateByName,
  authenticateWithQuickConnect,
  initiateQuickConnect,
  isQuickConnectEnabled,
  quickConnectState,
} from '@/api/jellyfin';
import { completeSignIn, type ServerInfo } from '@/auth/sign-in';
import { Button } from '@/components/button';
import { TextField, type TextFieldRef } from '@/components/text-field';
import { colors, radius, size, spacing, type } from '@/theme';

const POLL_MS = 2000;

export default function LoginScreen() {
  const params = useLocalSearchParams<{ url: string; serverId: string; serverName: string; version: string }>();
  const server: ServerInfo = {
    url: params.url,
    serverId: params.serverId,
    serverName: params.serverName,
    version: params.version || null,
  };
  const api = getApi(server.url, null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcEnabled, setQcEnabled] = useState(false);
  const [qcCode, setQcCode] = useState<string | null>(null);
  const passwordRef = useRef<TextFieldRef>(null);

  useEffect(() => {
    isQuickConnectEnabled(api).then(setQcEnabled);
  }, [api]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      completeSignIn(server, await authenticateByName(api, username.trim(), password));
    } catch (e) {
      const d = describeError(e);
      setError(d.kind === 'auth' ? 'Wrong username or password.' : `${d.title}. ${d.message}`);
      setBusy(false);
    }
  };

  // Quick Connect: show a code, poll until the user approves it on another device.
  const [qcSecret, setQcSecret] = useState<string | null>(null);
  const startQuickConnect = async () => {
    setError(null);
    try {
      const r = await initiateQuickConnect(api);
      if (!r.Secret || !r.Code) throw new Error('The server did not return a code.');
      setQcSecret(r.Secret);
      setQcCode(r.Code);
    } catch (e) {
      setError(describeError(e).title);
    }
  };

  useEffect(() => {
    if (!qcSecret) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const s = await quickConnectState(api, qcSecret);
        if (stopped || !s.Authenticated) return;
        stopped = true;
        clearInterval(timer);
        completeSignIn(server, await authenticateWithQuickConnect(api, qcSecret));
      } catch (e) {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        setQcSecret(null);
        setQcCode(null);
        setError(`Quick Connect stopped. ${describeError(e).message}`);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // server is derived from stable params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qcSecret, api]);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {server.serverName}
            {server.version ? ` · Jellyfin ${server.version}` : ''}
          </Text>

          {qcCode ? (
            <View style={styles.qc}>
              <Text style={styles.qcLabel}>Enter this code in Jellyfin under Settings, Quick Connect:</Text>
              <Text style={styles.qcCode} selectable accessibilityLabel={`Code ${qcCode.split('').join(' ')}`}>
                {qcCode}
              </Text>
              <Text style={styles.qcHint}>Waiting for approval…</Text>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setQcSecret(null);
                  setQcCode(null);
                }}
              />
            </View>
          ) : (
            <>
              <TextField
                label="Username"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                autoComplete="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                accessibilityLabel="Username"
              />
              <TextField
                ref={passwordRef}
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={signIn}
                accessibilityLabel="Password"
              />
              {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}
              <Button title="Sign In" onPress={signIn} loading={busy} disabled={!username.trim()} />
              {qcEnabled ? (
                <Button title="Use Quick Connect" icon="qrcode" variant="secondary" onPress={startQuickConnect} />
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  inner: { width: '100%', maxWidth: size.formMaxWidth, alignSelf: 'center', gap: spacing.lg },
  title: { ...type.largeTitle, color: colors.text },
  subtitle: { ...type.body, color: colors.textSecondary, marginTop: -spacing.sm },
  error: { ...type.callout, color: colors.danger },
  qc: { gap: spacing.lg, backgroundColor: colors.surface, padding: spacing.xl, borderRadius: radius.lg },
  qcLabel: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  qcCode: { ...type.code, color: colors.text, textAlign: 'center' },
  qcHint: { ...type.callout, color: colors.textTertiary, textAlign: 'center' },
});
