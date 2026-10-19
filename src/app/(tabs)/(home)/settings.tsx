import * as Application from 'expo-application';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { dropApi } from '@/api/client';
import { logout } from '@/api/jellyfin';
import { clearQueryCache } from '@/api/query-client';
import { useApi } from '@/api/use-api';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { toast } from '@/lib/toast';
import { colors, radius, size, spacing, type } from '@/theme';

function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // RN Web has no Alert with buttons.
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function SettingsScreen() {
  const { session, api } = useApi();
  const [busy, setBusy] = useState(false);
  const id = clientIdentity();

  const signOut = async () => {
    if (!(await confirm('Sign out?', `You will be signed out of ${session.serverName}.`, 'Sign Out'))) return;
    setBusy(true);
    // Tell the server, but never let a dead server keep the user signed in.
    await Promise.race([logout(api).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    dropApi(session.serverUrl, session.token);
    clearQueryCache();
    useSessionStore.getState().signOut();
  };

  const clearCache = async () => {
    if (!(await confirm('Clear cache?', 'Cached pages and images are removed. Nothing on the server changes.', 'Clear'))) return;
    clearQueryCache();
    try {
      const { Image } = await import('expo-image');
      await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]);
    } catch {
      // Image cache clearing is best effort.
    }
    toast('Cache cleared');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <View style={styles.profile}>
            <Avatar session={session} size={size.avatarLarge} />
            <View style={styles.flex}>
              <Text style={styles.name}>{session.userName}</Text>
              <Text style={styles.muted}>{session.serverName}</Text>
            </View>
          </View>

          <Section title="Server">
            <Row label="Name" value={session.serverName} />
            <Row label="Address" value={session.serverUrl} />
            <Row label="Version" value={session.serverVersion ? `Jellyfin ${session.serverVersion}` : 'Unknown'} last />
          </Section>

          <Section title="Account">
            <Row label="User" value={session.userName} last />
          </Section>

          <Section title="This device">
            <Row label="Device" value={id.device} />
            <Row label="App version" value={`${Application.nativeApplicationVersion ?? id.version}${Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}`} last />
          </Section>

          <Button title="Clear Cache" variant="secondary" icon="trash" onPress={clearCache} />
          <Button title="Sign Out" variant="secondary" icon="rectangle.portrait.and.arrow.right" onPress={signOut} loading={busy} />
          <Text style={styles.footnote}>Zoggyfin is open source under the MPL-2.0. It is not affiliated with the Jellyfin project.</Text>
        </View>
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  inner: { width: '100%', maxWidth: size.settingsMaxWidth, alignSelf: 'center', gap: spacing.lg },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.sm },
  name: { ...type.headline, color: colors.text },
  muted: { ...type.callout, color: colors.textSecondary, marginTop: spacing.xxs },
  section: { gap: spacing.sm },
  sectionTitle: { ...type.label, color: colors.textSecondary, marginLeft: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: size.rowHeight, gap: spacing.lg },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  label: { ...type.body, color: colors.text },
  value: { ...type.body, color: colors.textSecondary, flexShrink: 1, textAlign: 'right' },
  footnote: { ...type.caption, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.md, lineHeight: 17 },
});
