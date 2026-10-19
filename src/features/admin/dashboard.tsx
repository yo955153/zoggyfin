/**
 * Dashboard: the server facts, a "restart pending" badge, sessions and
 * running tasks at a glance, and storage per library path.
 */
import type { FolderStorageDto } from '@jellyfin/sdk/lib/generated-client/models';
import { Text, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { createStyles, type AppTheme, font, spacing, type, useStyles } from '@/theme';

import type { AdminTarget } from './access';
import { formatDiskSize, taskStatus, usedShare } from './logic';
import { openAdminSection } from './nav';
import { useLive, useSessions, useStorage, useSystemInfo, useTasks } from './queries';
import { Badge, Bar, Card, CardGrid, Fact, SectionHeader } from './ui';

export function DashboardSection({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const live = useLive();
  const info = useSystemInfo(target);
  const sessions = useSessions(target, live);
  const tasks = useTasks(target, live);

  if (info.isPending) return <LoadingState rows={4} />;
  if (info.isError && !info.data) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  const i = info.data;
  const playing = (sessions.data ?? []).filter((x) => x.NowPlayingItem);
  const active = sessions.data?.length ?? 0;
  const running = (tasks.data ?? []).filter((t) => t.State === 'Running' || t.State === 'Cancelling');
  const os = [i.OperatingSystemDisplayName || i.OperatingSystem, i.SystemArchitecture].filter(Boolean).join(' · ');

  return (
    <View style={s.stack}>
      <Card>
        <View style={s.headRow}>
          <Text style={s.server} numberOfLines={2}>
            {i.ServerName || target.serverName}
          </Text>
          {target.fixture ? <Badge label="Fixture data" tone="neutral" /> : null}
        </View>
        <View style={s.badges}>
          {i.HasPendingRestart ? <Badge label="Restart pending" tone="warning" icon="arrow.clockwise" /> : null}
          {i.HasUpdateAvailable ? <Badge label="Update available" tone="accent" /> : null}
          {i.IsShuttingDown ? <Badge label="Shutting down" tone="danger" icon="power" /> : null}
        </View>
        <Fact label="Version" value={i.Version ? `Jellyfin ${i.Version}` : 'Unknown'} />
        <Fact label="Operating system" value={os || 'Unknown'} />
        {i.LocalAddress ? <Fact label="Local address" value={i.LocalAddress} mono /> : null}
      </Card>

      <CardGrid>
        {[
          <Touchable
            key="sessions"
            kind="tile"
            radius={14}
            onPress={() => openAdminSection(target.serverId, 'sessions')}
            accessibilityRole="button"
            accessibilityLabel={`Sessions: ${active} active, ${playing.length} playing. Open Now playing`}>
            <Card>
              <Text style={s.cardTitle}>Sessions</Text>
              {sessions.isError && !sessions.data ? (
                <Text style={s.muted}>Could not load the sessions.</Text>
              ) : (
                <View style={s.stats}>
                  <Stat value={sessions.data ? String(active) : '–'} label="active" />
                  <Stat value={sessions.data ? String(playing.length) : '–'} label="playing" />
                  <Stat value={sessions.data ? String(playing.filter((p) => p.PlayState?.PlayMethod === 'Transcode').length) : '–'} label="transcoding" />
                </View>
              )}
            </Card>
          </Touchable>,
          <Touchable
            key="tasks"
            kind="tile"
            radius={14}
            onPress={() => openAdminSection(target.serverId, 'tasks')}
            accessibilityRole="button"
            accessibilityLabel={`Running tasks: ${running.length}. Open Scheduled tasks`}>
            <Card>
              <Text style={s.cardTitle}>Running tasks</Text>
              {running.length === 0 ? (
                <Text style={s.muted}>{tasks.isError && !tasks.data ? 'Could not load the tasks.' : 'No task runs now.'}</Text>
              ) : (
                running.map((t) => (
                  <View key={t.Id} style={s.task}>
                    <View style={s.taskRow}>
                      <Text style={s.taskName} numberOfLines={1}>
                        {t.Name}
                      </Text>
                      <Text style={s.taskPct}>{taskStatus(t).label.replace('Running · ', '')}</Text>
                    </View>
                    <Bar value={(t.CurrentProgressPercentage ?? 0) / 100} label={`${t.Name} progress`} />
                  </View>
                ))
              )}
            </Card>
          </Touchable>,
        ]}
      </CardGrid>

      <StorageCard target={target} />
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function StorageCard({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const q = useStorage(target);
  if (q.isPending) return null;
  if (q.isError) {
    return (
      <View>
        <SectionHeader title="Storage" />
        <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
      </View>
    );
  }
  // Older servers have no storage endpoint: the dashboard leaves the card out.
  if (!q.data) return null;
  const libs = q.data.Libraries ?? [];
  const system: { name: string; f: FolderStorageDto | undefined }[] = [
    { name: 'Transcode folder', f: q.data.TranscodingTempFolder },
    { name: 'Cache', f: q.data.CacheFolder },
    { name: 'Server data', f: q.data.ProgramDataFolder },
  ];
  return (
    <View style={s.stackTight}>
      <SectionHeader title="Storage" />
      <Card>
        {libs.length === 0 ? <Text style={s.muted}>No library folders.</Text> : null}
        {libs.map((l) => (
          <View key={l.Id} style={s.lib}>
            <Text style={s.libName}>{l.Name}</Text>
            {(l.Folders ?? []).map((f) => (
              <Disk key={f.Path} label={f.Path} f={f} />
            ))}
          </View>
        ))}
        <View style={s.lib}>
          <Text style={s.libName}>Server</Text>
          {system.map((x) => (x.f ? <Disk key={x.name} label={`${x.name} · ${x.f.Path}`} f={x.f} /> : null))}
        </View>
      </Card>
    </View>
  );
}

function Disk({ label, f }: { label: string; f: FolderStorageDto }) {
  const s = useStyles(makeStyles);
  const share = usedShare(f.UsedSpace, f.FreeSpace);
  const free = f.FreeSpace != null ? `${formatDiskSize(f.FreeSpace)} free` : null;
  const total = f.UsedSpace != null && f.FreeSpace != null ? `of ${formatDiskSize(f.UsedSpace + f.FreeSpace)}` : null;
  const tone = share !== null && share > 0.95 ? 'danger' : share !== null && share > 0.85 ? 'warning' : 'accent';
  return (
    <View style={s.disk}>
      <View style={s.taskRow}>
        <Text style={s.path} numberOfLines={1} ellipsizeMode="middle">
          {label}
        </Text>
        <Text style={s.diskFree}>{[free, total].filter(Boolean).join(' ') || 'Size unknown'}</Text>
      </View>
      {share !== null ? <Bar value={share} tone={tone} label={`${label}: ${Math.round(share * 100)} % used`} /> : null}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  stack: { gap: spacing.xxl },
  stackTight: { gap: spacing.sm - 2 },
  headRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: spacing.md },
  server: { ...font(type.title3), color: c.text, flexShrink: 1 },
  badges: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  cardTitle: { ...font(type.headline), color: c.text },
  muted: { ...font(type.subheadline), color: c.text2 },
  stats: { flexDirection: 'row' as const, gap: spacing.xl },
  stat: { gap: 2 },
  statValue: { ...font(type.title1, { tabular: true }), color: c.text },
  statLabel: { ...font(type.footnote), color: c.text2 },
  task: { gap: spacing.xs + 2 },
  taskRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: spacing.md, alignItems: 'baseline' as const },
  taskName: { ...font(type.subheadline), color: c.text, flexShrink: 1 },
  taskPct: { ...font(type.footnote, { tabular: true }), color: c.text2 },
  lib: { gap: spacing.sm },
  libName: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text },
  disk: { gap: spacing.xs + 2 },
  path: { ...font(type.footnote), color: c.text2, flexShrink: 1 },
  diskFree: { ...font(type.footnote, { tabular: true }), color: c.text2 },
}));
