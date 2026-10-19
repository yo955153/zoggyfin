import * as Application from 'expo-application';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, View } from 'react-native';

import { dropApi } from '@/api/client';
import { logout } from '@/api/jellyfin';
import { clearQueryCache } from '@/api/query-client';
import { useApi } from '@/api/use-api';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Icon, type IconName } from '@/components/icon';
import { type Option, OptionSheet } from '@/components/option-sheet';
import { Touchable } from '@/components/touchable';
import { toast } from '@/lib/toast';
import { isTV } from '@/platform/tv';
import { APPEARANCE_OPTIONS, useAppearance } from '@/settings/appearance';
import { QUALITY_OPTIONS, qualityLabel, SKIP_OPTIONS, usePlaybackSettings } from '@/settings/playback';
import { createStyles, type AppTheme, font, iconSize, mediaColors, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

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
  const styles = useStyles(makeStyles);
  const { c } = useTheme();
  const { session, api } = useApi();
  const [busy, setBusy] = useState(false);
  const id = clientIdentity();

  const signOut = async () => {
    if (!(await confirm('Sign out?', `You will be signed out of ${session.serverName}.`, 'Sign out'))) return;
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
    toast('Cache cleared', { icon: 'checkmark' });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <Group>
            <View style={[styles.row, styles.account]}>
              <Avatar session={session} size={sizes.avatarLarge} />
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>
                  {session.userName}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {session.serverName}
                </Text>
              </View>
            </View>
          </Group>

          <AppearanceSection />

          <PlaybackSection />

          <Group title="Server">
            <InfoRow icon="server" label="Name" value={session.serverName} />
            <InfoRow icon="info.circle" label="Address" value={session.serverUrl} />
            <InfoRow icon="gauge" label="Version" value={session.serverVersion ? `Jellyfin ${session.serverVersion}` : 'Unknown'} last />
          </Group>

          <Group title="This device" footer="Zoggyfin is open source under the MPL-2.0. It is not affiliated with the Jellyfin project.">
            <InfoRow icon="tv" label="Device" value={id.device} />
            <InfoRow
              icon="square.stack"
              label="App version"
              value={`${Application.nativeApplicationVersion ?? id.version}${Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}`}
              last
            />
          </Group>

          <Group>
            <ActionRow label="Clear cache" onPress={clearCache} />
          </Group>
          <Group>
            <ActionRow label={busy ? 'Signing out' : 'Sign out'} onPress={signOut} disabled={busy} />
          </Group>
        </View>
      </ScrollView>
    </>
  );
}

/** RN Web paints the "on" thumb green unless told otherwise; the RN types do not list the prop. */
const webSwitchColors: object = Platform.OS === 'web' ? { activeThumbColor: mediaColors.white } : {};

type PickerKey = 'wifi' | 'cellular' | 'back' | 'forward' | null;

function AppearanceSection() {
  const choice = useAppearance((st) => st.choice);
  const setChoice = useAppearance((st) => st.setChoice);
  const { c } = useTheme();
  return (
    <Group title="Appearance" footer="System follows the light or dark setting of this device. Players are always dark.">
      {APPEARANCE_OPTIONS.map((o, i) => (
        <SettingsRow
          key={o.value}
          icon={o.value === 'system' ? 'circle.lefthalf.filled' : o.value === 'dark' ? 'moon.fill' : 'sun.max.fill'}
          label={o.label}
          onPress={() => setChoice(o.value)}
          role="radio"
          checked={choice === o.value}
          last={i === APPEARANCE_OPTIONS.length - 1}
          trailing={choice === o.value ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : <View />}
        />
      ))}
    </Group>
  );
}

function PlaybackSection() {
  const st = usePlaybackSettings();
  const [picker, setPicker] = useState<PickerKey>(null);
  const { c } = useTheme();
  const quality: Option<number>[] = QUALITY_OPTIONS.map((q) => ({ value: q.value, label: q.label }));
  const skips: Option<number>[] = SKIP_OPTIONS.map((n) => ({ value: n, label: `${n} s` }));
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
  const cellular = Platform.OS !== 'web' && !isTV;
  return (
    <Group title="Playback">
      <SettingsRow icon="gauge" label="Quality on Wi-Fi" value={qualityLabel(st.wifiBitrate)} onPress={() => setPicker('wifi')} />
      {cellular ? (
        <SettingsRow icon="antenna.radiowaves.left.and.right" label="Quality on cellular" value={qualityLabel(st.cellularBitrate)} onPress={() => setPicker('cellular')} />
      ) : null}
      <SettingsRow icon="gobackward.10" label="Skip back" value={`${st.skipBackSeconds} s`} onPress={() => setPicker('back')} />
      <SettingsRow icon="goforward.10" label="Skip forward" value={`${st.skipForwardSeconds} s`} onPress={() => setPicker('forward')} />
      <SettingsRow
        icon="forward.fill"
        label="Play next episode automatically"
        onPress={() => st.update({ autoplayNext: !st.autoplayNext })}
        role="switch"
        checked={st.autoplayNext}
        last
        trailing={
          <Switch
            value={st.autoplayNext}
            onValueChange={(v) => st.update({ autoplayNext: v })}
            trackColor={{ true: c.accent, false: c.surface3 }}
            thumbColor={mediaColors.white}
            {...webSwitchColors}
            accessibilityLabel="Play next episode automatically"
          />
        }
      />
      <OptionSheet
        visible={sheet !== null}
        title={sheet?.title ?? ''}
        options={sheet?.options ?? []}
        selected={sheet ? [sheet.selected] : []}
        onSelect={(v) => sheet?.set(v)}
        onClose={() => setPicker(null)}
      />
    </Group>
  );
}

/** An inset grouped section (design system §7.15). */
function Group({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

function LeadingIcon({ name }: { name: IconName }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.leading}>
      <Icon name={name} size={scaled(iconSize.sm - 1)} color={mediaColors.white} />
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  last,
  trailing,
  role = 'button',
  checked,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
  trailing?: React.ReactNode;
  role?: 'button' | 'radio' | 'switch';
  checked?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityState={checked === undefined ? undefined : { checked }}
      style={({ pressed, hovered, focused }) => [styles.rowPad, (pressed || hovered || focused) && styles.rowPressed]}>
      <LeadingIcon name={icon} />
      <View style={[styles.row, styles.rowBody, !last && styles.rowBorder]}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.trailing}>
          {value ? (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {trailing ?? <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />}
        </View>
      </View>
    </Touchable>
  );
}

function InfoRow({ icon, label, value, last }: { icon: IconName; label: string; value: string; last?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.rowPad} accessible accessibilityLabel={`${label}: ${value}`}>
      <LeadingIcon name={icon} />
      <View style={[styles.row, styles.rowBody, !last && styles.rowBorder]}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={1} selectable>
          {value}
        </Text>
      </View>
    </View>
  );
}

function ActionRow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered, focused }) => [styles.row, styles.actionRow, (pressed || hovered || focused) && styles.rowPressed]}>
      <Text style={styles.destructive}>{label}</Text>
    </Touchable>
  );
}

const makeStyles = createStyles(({ c, scheme }: AppTheme) => ({
  flex: { flex: 1 },
  page: { backgroundColor: c.bgGrouped },
  content: { padding: spacing.lg, paddingBottom: spacing.huge * 2 },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.settingsMaxWidth), alignSelf: 'center' as const, gap: spacing.xxl },
  account: { minHeight: scaled(sizes.settingsAccountRow + 12), gap: spacing.md, paddingHorizontal: spacing.lg },
  name: { ...font(type.headline), color: c.text },
  muted: { ...font(type.subheadline), color: c.text2, marginTop: spacing.xxs },
  section: { gap: spacing.sm - 2 },
  sectionTitle: { ...font(type.footnote), letterSpacing: 0.4, color: c.text2, marginLeft: spacing.lg },
  footer: { ...font(type.footnote), color: c.text2, marginHorizontal: spacing.lg },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  rowPad: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingLeft: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: scaled(sizes.settingsRow), gap: spacing.md },
  rowBody: { flex: 1, justifyContent: 'space-between' as const, paddingRight: spacing.lg, paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  rowPressed: { backgroundColor: c.surface3 },
  leading: {
    width: scaled(sizes.settingsIcon),
    height: scaled(sizes.settingsIcon),
    borderRadius: sizes.settingsIconRadius,
    backgroundColor: scheme === 'light' ? c.text3 : c.surface3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderCurve: 'continuous' as const,
  },
  label: { ...font(type.body), color: c.text, flexShrink: 1 },
  trailing: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, flexShrink: 1 },
  value: { ...font(type.body), color: c.text2, flexShrink: 1, textAlign: 'right' as const },
  actionRow: { justifyContent: 'center' as const },
  destructive: { ...font(type.body), color: c.danger, textAlign: 'center' as const },
}));
