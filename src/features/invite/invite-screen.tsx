/**
 * Settings, Servers, <server>, Invite someone (administrators only).
 *
 * The short way: type a name, tap Send. The app makes the Jellyfin user with
 * a one-time password and opens the share sheet with the invite link. All
 * libraries, downloads and remote access are on by default; "Options"
 * changes them. The pending invites (users that never signed in) are below,
 * with Resend and Cancel invite.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';

import { describeError } from '@/api/errors';
import { scopeKey } from '@/api/query-keys';
import { useApi } from '@/api/use-api';
import { findServer } from '@/auth/accounts';
import { useAccounts } from '@/auth/session-store';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { EmptyState } from '@/components/states';
import { TextField } from '@/components/text-field';
import { Touchable } from '@/components/touchable';
import { Group, makeSettingsStyles, SettingsRow, webSwitchColors } from '@/features/settings/rows';
import { InviteQr } from '@/features/invite/invite-qr';
import { addressChoices, addressWarning, chosenAddresses, LABEL_TEXT } from '@/invite/addresses';
import { createInvitedUser, deleteUser, getLibraries, getUsers, setPasswordAsAdmin } from '@/invite/api';
import { inviteExtensions } from '@/invite/extensions';
import { type Invite, inviteLink, inviteMessage, LIMITS, needsTunnel } from '@/invite/payload';
import { DEFAULT_OPTIONS, makeOneTimePassword, usernameFor } from '@/invite/policy';
import { secureRandom } from '@/invite/random';
import { addRecord, type InviteRecord, pendingInvites, pruneRecords, readRecords, removeRecord, writeRecords } from '@/invite/records';
import { canCopy, copyText, shareInvite } from '@/invite/share';
import { confirmDestructive } from '@/lib/confirm';
import { toast } from '@/lib/toast';
import { createStyles, type AppTheme, font, iconSize, mediaColors, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

interface Sent {
  userName: string;
  link: string;
  message: string;
}

export function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  const sidebar = useSidebarInset();
  const server = findServer(useAccounts(), id);
  const { api, session, scope } = useApi();
  const qc = useQueryClient();
  const extensions = useMemo(() => inviteExtensions()?.extensionsForInvite() ?? [], []);

  const [name, setName] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [libs, setLibs] = useState<Set<string> | null>(null); // null: all
  const [allowDownloads, setAllowDownloads] = useState(DEFAULT_OPTIONS.allowDownloads);
  const [allowRemote, setAllowRemote] = useState(DEFAULT_OPTIONS.allowRemote);
  const [vpn, setVpn] = useState<Set<string>>(new Set());
  const choices = useMemo(() => addressChoices(server?.addresses ?? [], vpn), [server?.addresses, vpn]);
  const [chosen, setChosen] = useState<Set<string> | null>(null); // null: the default choice
  const chosenSet = useMemo(() => chosen ?? new Set(choices.filter((x) => x.include).map((x) => x.url)), [chosen, choices]);
  const addresses = chosenAddresses(choices, chosenSet);
  const warning = addressWarning(addresses);
  const [withExtensions, setWithExtensions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  const libraries = useQuery({ queryKey: [...scopeKey(scope), 'invite', 'libraries'], queryFn: () => getLibraries(api), enabled: showOptions });
  const pendingKey = [...scopeKey(scope), 'invite', 'pending'];
  const pending = useQuery({
    queryKey: pendingKey,
    queryFn: async (): Promise<InviteRecord[]> => {
      const users = await getUsers(api);
      const records = readRecords();
      writeRecords(pruneRecords(records, session.serverId, users));
      return pendingInvites(records, session.serverId, users);
    },
  });

  if (!server || server.id !== session.serverId) {
    return (
      <>
        <Stack.Screen options={{ title: 'Invite someone', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
        <EmptyState icon="server.rack" title="Switch to this server first" message="Invites use your account on this server." />
      </>
    );
  }

  const buildInvite = (userName: string, password: string): Invite => {
    const inv: Invite = { serverId: server.id, serverName: server.name, addresses, userName, password, inviter: session.userName };
    if (withExtensions && extensions.length) inv.extensions = extensions.slice(0, LIMITS.extensions);
    return inv;
  };

  const share = async (s: Sent) => {
    const r = await shareInvite(s.message, `Join ${server.name}`);
    if (r === 'copied') toast('The invite is copied. Paste it in a message.', { icon: 'checkmark' });
    else if (r === 'failed') toast('Could not open the share sheet. Use the QR code or copy the link.');
  };

  const send = async () => {
    setError(null);
    const userName = usernameFor(name);
    if (!userName) return setError('Enter a name with letters or numbers.');
    if (warning === 'none') return setError('Choose at least one address.');
    const random = secureRandom();
    if (!random) return setError('This app version cannot make a safe password. Update the app, or invite from the web app.');
    setBusy(true);
    try {
      const password = makeOneTimePassword(random);
      const user = await createInvitedUser(api, userName, password, {
        libraryIds: libs ? [...libs] : null,
        allowDownloads,
        allowRemote,
      });
      addRecord({ serverId: server.id, userId: user.Id as string, userName, createdAt: new Date().toISOString() });
      const link = inviteLink(buildInvite(userName, password));
      const s: Sent = { userName, link, message: inviteMessage({ inviter: session.userName, serverName: server.name }, link) };
      setSent(s);
      setName('');
      void qc.invalidateQueries({ queryKey: pendingKey });
      setBusy(false);
      void share(s);
    } catch (e) {
      const d = describeError(e);
      setError(
        d.status === 400
          ? `The server did not accept the name "${userName}". A user with this name can exist already. Use another name.`
          : d.kind === 'forbidden' || d.kind === 'auth'
            ? 'Your account cannot add users on this server. Only an administrator can.'
            : `${d.title}. ${d.message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const resend = async (r: InviteRecord) => {
    const random = secureRandom();
    if (!random) return toast('This app version cannot make a safe password.');
    try {
      const password = makeOneTimePassword(random);
      // A new one-time password: the old link stops working.
      await setPasswordAsAdmin(api, r.userId, password);
      const link = inviteLink(buildInvite(r.userName, password));
      const s: Sent = { userName: r.userName, link, message: inviteMessage({ inviter: session.userName, serverName: server.name }, link) };
      setSent(s);
      await share(s);
    } catch (e) {
      toast(describeError(e).title);
    }
  };

  const cancel = async (r: InviteRecord) => {
    if (!(await confirmDestructive(`Cancel the invite for ${r.userName}?`, `This deletes the user ${r.userName} from ${server.name}. The invite link stops working.`, 'Cancel invite'))) return;
    try {
      await deleteUser(api, r.userId);
      removeRecord(server.id, r.userId);
      if (sent?.userName === r.userName) setSent(null);
      void qc.invalidateQueries({ queryKey: pendingKey });
      toast(`The invite for ${r.userName} is cancelled.`, { icon: 'checkmark' });
    } catch (e) {
      toast(describeError(e).title);
    }
  };

  const toggleSet = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const allLibIds = libraries.data?.map((l) => l.id) ?? [];
  const tunnel = needsTunnel(addresses);

  return (
    <>
      <Stack.Screen options={{ title: 'Invite someone', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.page}
        contentContainerStyle={[styles.content, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          {sent ? <SentCard sent={sent} serverName={server.name} onShare={() => void share(sent)} onDone={() => setSent(null)} /> : null}

          <Group footer={`The person gets an account on ${server.name} and a link that signs them in. They set their own password after they join.`}>
            <InviteForm name={name} setName={setName} busy={busy} error={error} onSend={() => void send()} />
          </Group>

          {warning === 'home-only' ? (
            <Note icon="exclamationmark.triangle" text="These addresses work only on your home network. Away from home the person cannot connect. Open Options and add an internet, Tailscale or VPN address." warn />
          ) : null}
          {tunnel ? <Note icon="info.circle" text={`The person must connect to your ${tunnel === 'tailscale' ? 'Tailscale' : 'VPN'} first. The invite tells them.`} /> : null}

          <Group>
            <SettingsRow
              icon="gearshape"
              label="Options"
              value={showOptions ? undefined : 'All libraries'}
              onPress={() => setShowOptions((v) => !v)}
              last
              trailing={<Icon name={showOptions ? 'chevron.up' : 'chevron.down'} size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />}
            />
          </Group>

          {showOptions ? (
            <>
              <Group title="Libraries" footer={libs === null ? 'All libraries, also new ones.' : `${libs.size} of ${allLibIds.length} libraries.`}>
                {libraries.isPending ? <Note text="Loading the libraries." /> : null}
                {libraries.isError ? <Note text="Could not load the libraries. All libraries stay on." warn /> : null}
                {(libraries.data ?? []).map((l, i, arr) => {
                  const on = libs === null || libs.has(l.id);
                  return (
                    <CheckRow
                      key={l.id}
                      label={l.name}
                      checked={on}
                      last={i === arr.length - 1}
                      onPress={() => {
                        const next = toggleSet(libs ?? new Set(allLibIds), l.id);
                        setLibs(next.size === allLibIds.length ? null : next);
                      }}
                    />
                  );
                })}
              </Group>
              <Group title="Permissions" footer="The person is never an administrator.">
                <SwitchRow icon="arrow.down.circle" label="Allow downloads" value={allowDownloads} onChange={setAllowDownloads} />
                <SwitchRow icon="globe" label="Allow access away from home" value={allowRemote} onChange={setAllowRemote} last />
              </Group>
              <Group title="Addresses in the invite" footer="The app of the person tries these addresses and uses the first one that answers. Home network addresses work only at your home.">
                {choices.map((a, i) => (
                  <View key={a.url}>
                    <CheckRow
                      label={a.url}
                      sub={LABEL_TEXT[a.label]}
                      checked={chosenSet.has(a.url)}
                      last={i === choices.length - 1 && !(a.label === 'home' || vpn.has(a.url))}
                      onPress={() => setChosen(toggleSet(chosenSet, a.url))}
                    />
                    {a.label === 'home' || vpn.has(a.url) ? (
                      <MarkVpn
                        on={vpn.has(a.url)}
                        onPress={() => {
                          const next = toggleSet(vpn, a.url);
                          setVpn(next);
                          // A VPN address works away from home: include it.
                          if (next.has(a.url)) setChosen(new Set([...chosenSet, a.url]));
                        }}
                      />
                    ) : null}
                  </View>
                ))}
              </Group>
              {extensions.length ? (
                <Group title="Extensions" footer={`The person gets an offer to add them: ${extensions.map((u) => u.replace(/^https?:\/\//, '')).join(', ')}`}>
                  <SwitchRow icon="square.grid.2x2" label="Include my extensions" value={withExtensions} onChange={setWithExtensions} last />
                </Group>
              ) : null}
            </>
          ) : null}

          <Group title="Pending invites" footer="People who did not sign in yet. Resend makes a new link; the old link stops working.">
            {pending.isPending ? <Note text="Loading." /> : null}
            {pending.isError ? <Note text="Could not load the users of this server." warn /> : null}
            {pending.data && !pending.data.length ? <Note text="No pending invites." /> : null}
            {(pending.data ?? []).map((r) => (
              <PendingRow key={r.userId} record={r} onResend={() => void resend(r)} onCancel={() => void cancel(r)} />
            ))}
          </Group>
        </View>
      </ScrollView>
    </>
  );
}

function InviteForm({ name, setName, busy, error, onSend }: { name: string; setName: (s: string) => void; busy: boolean; error: string | null; onSend: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.pad}>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Jane Doe"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={onSend}
        accessibilityLabel="Name of the person"
        maxLength={64}
      />
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Send invite" icon="person.badge.plus" onPress={onSend} loading={busy} disabled={!name.trim()} />
    </View>
  );
}

function SentCard({ sent, serverName, onShare, onDone }: { sent: Sent; serverName: string; onShare: () => void; onDone: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <Group title={`Invite for ${sent.userName}`} footer="Show the QR code to a person in the same room. The link has a one-time password: send it only to this person.">
      <View style={[s.pad, s.center]}>
        <InviteQr value={sent.link} size={scaled(220)} label={`QR code of the invite to ${serverName}`} />
        <View style={s.buttons}>
          <Button title="Share again" variant="smallTonal" onPress={onShare} />
          {canCopy ? (
            <Button
              title="Copy link"
              variant="smallTonal"
              onPress={() => void copyText(sent.link).then((ok) => toast(ok ? 'The link is copied.' : 'Could not copy the link.'))}
            />
          ) : null}
          <Button title="Done" variant="text" onPress={onDone} />
        </View>
      </View>
    </Group>
  );
}

function PendingRow({ record, onResend, onCancel }: { record: InviteRecord; onResend: () => void; onCancel: () => void }) {
  const s = useStyles(makeStyles);
  const rs = useStyles(makeSettingsStyles);
  const date = new Date(record.createdAt);
  return (
    <View style={[s.pad, s.pendingRow, rs.rowBorder]}>
      <View style={s.flex}>
        <Text style={rs.label} numberOfLines={1}>
          {record.userName}
        </Text>
        <Text style={s.sub}>{`Invited ${Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()}`}</Text>
      </View>
      <Button title="Resend" variant="smallTonal" onPress={onResend} accessibilityLabel={`Resend the invite for ${record.userName}`} />
      <Touchable onPress={onCancel} hitSlop={8} radius={8} accessibilityRole="button" accessibilityLabel={`Cancel the invite for ${record.userName}`} style={s.cancel}>
        <Text style={s.cancelText}>Cancel</Text>
      </Touchable>
    </View>
  );
}

function CheckRow({ label, sub, checked, last, onPress }: { label: string; sub?: string; checked: boolean; last?: boolean; onPress: () => void }) {
  const rs = useStyles(makeSettingsStyles);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={({ pressed, hovered, focused }) => [rs.rowPad, (pressed || hovered || focused) && rs.rowPressed]}>
      <Icon name={checked ? 'checkmark.circle.fill' : 'circle'} size={scaled(iconSize.md)} color={checked ? c.accent : c.text3} />
      <View style={[rs.row, rs.rowBody, !last && rs.rowBorder]}>
        <View style={s.flex}>
          <Text style={rs.label} numberOfLines={1}>
            {label}
          </Text>
          {sub ? <Text style={s.sub}>{sub}</Text> : null}
        </View>
      </View>
    </Touchable>
  );
}

function MarkVpn({ on, onPress }: { on: boolean; onPress: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <Touchable onPress={onPress} accessibilityRole="button" style={s.markVpn}>
      <Text style={s.link}>{on ? 'Not a VPN address' : 'This is a VPN address (WireGuard)'}</Text>
    </Touchable>
  );
}

function SwitchRow({ icon, label, value, onChange, last }: { icon: 'arrow.down.circle' | 'globe' | 'square.grid.2x2'; label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const { c } = useTheme();
  return (
    <SettingsRow
      icon={icon}
      label={label}
      role="switch"
      checked={value}
      onPress={() => onChange(!value)}
      last={last}
      trailing={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: c.accent, false: c.surface3 }}
          thumbColor={mediaColors.white}
          {...webSwitchColors}
          accessibilityLabel={label}
        />
      }
    />
  );
}

function Note({ text, icon, warn }: { text: string; icon?: 'info.circle' | 'exclamationmark.triangle'; warn?: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={[s.note, s.pad]}>
      {icon ? <Icon name={icon} size={scaled(iconSize.sm)} color={warn ? c.warning : c.text2} /> : null}
      <Text style={[s.noteText, warn ? { color: c.warning } : null]}>{text}</Text>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  pad: { padding: spacing.lg, gap: spacing.md },
  center: { alignItems: 'center' as const },
  buttons: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  error: { ...font(type.footnote), color: c.danger },
  sub: { ...font(type.footnote), color: c.text2 },
  note: { flexDirection: 'row' as const, alignItems: 'flex-start' as const },
  noteText: { ...font(type.subheadline), color: c.text2, flex: 1 },
  pendingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: spacing.sm, minHeight: scaled(sizes.settingsRow) },
  cancel: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  cancelText: { ...font(type.subheadline), color: c.danger },
  markVpn: { paddingLeft: spacing.lg + scaled(iconSize.md) + spacing.md, paddingBottom: spacing.sm, borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  link: { ...font(type.footnote), color: c.accent },
}));
