/**
 * "Servers on this network" on the server address screen, the card that
 * explains local network access before the system prompt, and the help when
 * access is off.
 */
import { ActivityIndicator, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import type { LanHelp } from '@/servers/discovery/lan-access';
import { isSaved, sortForList } from '@/servers/discovery/merge';
import type { DiscoveredServer } from '@/servers/discovery/types';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import type { ServerDiscovery } from './use-server-discovery';

function Card({
  icon,
  title,
  body,
  tone = 'accent',
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  tone?: 'accent' | 'warning';
  children?: React.ReactNode;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={s.card} accessibilityRole="summary">
      <View style={s.cardHeader}>
        <View style={[s.badge, tone === 'warning' && s.badgeWarning]}>
          <Icon name={icon} size={scaled(iconSize.sm)} color={tone === 'warning' ? c.warning : c.accent} />
        </View>
        <View style={s.cardText}>
          <Text style={s.cardTitle} accessibilityRole="header">
            {title}
          </Text>
          <Text style={s.cardBody}>{body}</Text>
        </View>
      </View>
      {children ? <View style={s.cardButtons}>{children}</View> : null}
    </View>
  );
}

/** Before the system prompt: why the app needs local network access. */
export function LanPrimerCard({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  return (
    <Card icon="wifi" title="Find servers on your network" body="Zoggyfin needs local network access to reach a server at home.">
      <Button title="Not now" variant="smallTonal" onPress={onSkip} accessibilityLabel="Not now. I use an internet address." />
      <Button title="Continue" variant="small" onPress={onContinue} />
    </Card>
  );
}

const VPN_HINT = 'If you use a VPN such as WireGuard, check that it is connected.';

const HELP: Record<LanHelp, { title: string; body: string; settings: boolean }> = {
  'lan-access': {
    title: 'Local network access is off',
    body: 'Zoggyfin cannot reach servers on this network. Turn on Local Network for Zoggyfin in Settings. An internet address still works.',
    settings: true,
  },
  'lan-access-vpn': {
    title: 'Local network access is off',
    body: `Zoggyfin cannot reach this server. Turn on Local Network for Zoggyfin in Settings. ${VPN_HINT}`,
    settings: true,
  },
  vpn: {
    title: 'Cannot reach the server',
    body: `${VPN_HINT} Or make sure you are on the same network as the server.`,
    settings: false,
  },
  tailscale: {
    title: 'Cannot reach the server over Tailscale',
    body: 'This address is on a Tailscale network. Check that Tailscale is connected on this device, then try again.',
    settings: false,
  },
};

/** Why a local, VPN or Tailscale address does not answer, and what to do. Internet addresses still work. */
export function LanAccessHelp({ kind = 'lan-access', onOpenSettings }: { kind?: LanHelp; onOpenSettings: () => void }) {
  const h = HELP[kind];
  return (
    <Card icon="wifi.exclamationmark" tone="warning" title={h.title} body={h.body}>
      {h.settings ? <Button title="Open Settings" variant="small" onPress={onOpenSettings} /> : null}
    </Card>
  );
}

function ServerRow({ server, saved, onPress }: { server: DiscoveredServer; saved: boolean; onPress: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const meta = [server.version ? `Jellyfin ${server.version}` : null, server.address].filter(Boolean).join(' · ');
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      style={s.row}
      accessibilityRole="button"
      accessibilityLabel={`${server.name}${saved ? ', saved' : ''}. ${meta}`}
      accessibilityHint="Uses this server"
    >
      <View style={s.rowIcon}>
        <Icon name="server.rack" size={scaled(iconSize.sm)} color={c.text} />
      </View>
      <View style={s.rowText}>
        <View style={s.rowTitleLine}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {server.name}
          </Text>
          {saved ? <Text style={s.savedBadge}>Saved</Text> : null}
        </View>
        <Text style={s.rowMeta} numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <Icon name="chevron.right" size={scaled(iconSize.xs)} color={c.text3} />
    </Touchable>
  );
}

/** The list of servers found nearby. Nothing on the web. */
export function NearbyServers({
  discovery,
  savedIds,
  onChoose,
}: {
  discovery: ServerDiscovery;
  savedIds: readonly string[];
  onChoose: (server: DiscoveredServer) => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { phase, servers, lan } = discovery;
  if (phase === 'off') return null;
  if (phase === 'primer') return <LanPrimerCard onContinue={discovery.allow} onSkip={discovery.skip} />;
  const busy = phase === 'searching' || phase === 'prompt';
  const list = sortForList(servers, savedIds);
  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={s.headerText} accessibilityRole="header">
          Servers on this network
        </Text>
        {busy ? (
          <ActivityIndicator size="small" color={c.text2} accessibilityLabel="Searching" />
        ) : (
          <Touchable kind="icon" radius={radius.pill} onPress={discovery.refresh} style={s.refresh} accessibilityRole="button" accessibilityLabel="Search again">
            <Icon name="arrow.clockwise" size={scaled(iconSize.sm)} color={c.accent} />
          </Touchable>
        )}
      </View>
      {lan === 'denied' && !list.length ? <LanAccessHelp onOpenSettings={discovery.openSettings} /> : null}
      {list.length ? (
        <View style={s.group}>
          {list.map((server, i) => (
            <View key={server.id}>
              {i > 0 ? <View style={s.separator} /> : null}
              <ServerRow server={server} saved={isSaved(server, savedIds)} onPress={() => onChoose(server)} />
            </View>
          ))}
        </View>
      ) : lan === 'denied' ? null : (
        <View style={s.group}>
          <Text style={s.empty} accessibilityLiveRegion="polite">
            {phase === 'prompt'
              ? 'Answer the system prompt to find servers.'
              : busy
                ? 'Searching…'
                : phase === 'paused'
                  ? 'Tap the search button to find servers on this network.'
                  : 'No servers found. Make sure you are on the same network as the server.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderCurve: 'continuous' as const,
    borderWidth: sizes.hairline,
    borderColor: c.separator,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: spacing.md },
  badge: {
    width: scaled(sizes.settingsIcon),
    height: scaled(sizes.settingsIcon),
    borderRadius: sizes.settingsIconRadius,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  badgeWarning: { backgroundColor: c.surface3 },
  cardText: { flex: 1, gap: spacing.xxs },
  cardTitle: { ...font(type.headline), color: c.text },
  cardBody: { ...font(type.footnote), color: c.text2 },
  cardButtons: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: spacing.sm },
  section: { gap: spacing.sm, marginTop: spacing.md },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    minHeight: scaled(sizes.iconButtonDense),
    paddingHorizontal: spacing.xs,
  },
  headerText: { ...font(type.footnote), color: c.text2, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  refresh: {
    width: scaled(sizes.iconButtonDense),
    height: scaled(sizes.iconButtonDense),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  group: { backgroundColor: c.surface, borderRadius: radius.lg, borderCurve: 'continuous' as const, overflow: 'hidden' as const },
  separator: { height: sizes.hairline, backgroundColor: c.separator, marginLeft: spacing.lg + scaled(sizes.settingsIcon) + spacing.md },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.rowMedia),
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowIcon: {
    width: scaled(sizes.settingsIcon),
    height: scaled(sizes.settingsIcon),
    borderRadius: sizes.settingsIconRadius,
    backgroundColor: c.surface3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rowText: { flex: 1, gap: spacing.xxs },
  rowTitleLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  rowTitle: { ...font(type.body), color: c.text, flexShrink: 1 },
  savedBadge: {
    ...font(type.caption1),
    fontWeight: '600' as const,
    color: c.accent,
    backgroundColor: c.accentSoft,
    borderRadius: radius.pill,
    overflow: 'hidden' as const,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  rowMeta: { ...font(type.footnote, { tabular: true }), color: c.text2 },
  empty: { ...font(type.footnote), color: c.text2, padding: spacing.lg },
}));
