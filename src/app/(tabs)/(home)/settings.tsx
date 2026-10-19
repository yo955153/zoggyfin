import * as Application from 'expo-application';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { dropApi } from '@/api/client';
import { logout } from '@/api/jellyfin';
import { clearQueryCache } from '@/api/query-client';
import { useApi } from '@/api/use-api';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { type Option, OptionSheet } from '@/components/option-sheet';
import { toast } from '@/lib/toast';
import { QUALITY_OPTIONS, qualityLabel, SKIP_OPTIONS, usePlaybackSettings } from '@/settings/playback';
import { colors, iconSize, radius, size, spacing, type } from '@/theme';

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

          <PlaybackSection />

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

type PickerKey = 'wifi' | 'cellular' | 'back' | 'forward' | null;

function PlaybackSection() {
  const st = usePlaybackSettings();
  const [picker, setPicker] = useState<PickerKey>(null);
  const quality: Option<number>[] = QUALITY_OPTIONS.map((q) => ({ value: q.value, label: q.label }));
  const skips: Option<number>[] = SKIP_OPTIONS.map((n) => ({ value: n, label: `${n} seconds` }));
  const sheet =
    picker === 'wifi'
      ? { title: 'Streaming quality on Wi-Fi', options: quality, selected: st.wifiBitrate, set: (v: number) => st.update({ wifiBitrate: v }) }
      : picker === 'cellular'
        ? { title: 'Streaming quality on cellular', options: quality, selected: st.cellularBitrate, set: (v: number) => st.update({ cellularBitrate: v }) }
        : picker === 'back'
          ? { title: 'Skip back', options: skips, selected: st.skipBackSeconds, set: (v: number) => st.update({ skipBackSeconds: v }) }
          : picker === 'forward'
            ? { title: 'Skip forward', options: skips, selected: st.skipForwardSeconds, set: (v: number) => st.update({ skipForwardSeconds: v }) }
            : null;
  return (
    <Section title="Playback">
      <PickRow label="Quality on Wi-Fi" value={qualityLabel(st.wifiBitrate)} onPress={() => setPicker('wifi')} />
      {Platform.OS !== 'web' ? (
        <PickRow label="Quality on cellular" value={qualityLabel(st.cellularBitrate)} onPress={() => setPicker('cellular')} />
      ) : null}
      <PickRow label="Skip back" value={`${st.skipBackSeconds} s`} onPress={() => setPicker('back')} />
      <PickRow label="Skip forward" value={`${st.skipForwardSeconds} s`} onPress={() => setPicker('forward')} />
      <View style={styles.row}>
        <Text style={styles.label}>Play next episode automatically</Text>
        <Switch value={st.autoplayNext} onValueChange={(v) => st.update({ autoplayNext: v })} trackColor={{ true: colors.accent }} />
      </View>
      <OptionSheet
        visible={sheet !== null}
        title={sheet?.title ?? ''}
        options={sheet?.options ?? []}
        selected={sheet ? [sheet.selected] : []}
        onSelect={(v) => sheet?.set(v)}
        onClose={() => setPicker(null)}
      />
    </Section>
  );
}

function PickRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, styles.rowBorder, (pressed || hovered) && styles.rowPressed]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pick}>
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        <Icon name="chevron.right" size={iconSize.md} color={colors.textTertiary} />
      </View>
    </Pressable>
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
  pick: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  rowPressed: { backgroundColor: colors.pressedRow },
  footnote: { ...type.caption, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.md, lineHeight: 17 },
});
