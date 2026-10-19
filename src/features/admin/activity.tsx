/**
 * Activity: the recent activity log of the server, newest first, with
 * filters (sign-ins, playback, errors) and paging ("Load more").
 */
import type { ActivityLogEntry } from '@jellyfin/sdk/lib/generated-client/models';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Icon, type IconName } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { createStyles, type AppTheme, font, iconSize, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import type { AdminTarget } from './access';
import { ACTIVITY_FILTERS, type ActivityFilter, activityMatches, formatSince } from './logic';
import { useActivity } from './queries';

function entryIcon(e: ActivityLogEntry): IconName {
  const t = e.Type ?? '';
  if (/Authentication|Session|LockedOut/.test(t)) return 'person';
  if (/Playback/.test(t)) return t.startsWith('Audio') ? 'music.note' : 'play.fill';
  if (/Task/.test(t)) return 'calendar.badge.clock';
  if (/User/.test(t)) return 'person.2';
  return 'info.circle';
}

export function ActivitySection({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const q = useActivity(target);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const entries = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items).filter((e) => activityMatches(e, filter)), [q.data, filter]);
  const total = q.data?.pages[0]?.total ?? 0;
  const loaded = (q.data?.pages ?? []).reduce((n, p) => n + p.count, 0);

  if (q.isPending) return <LoadingState rows={8} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <View style={s.stack}>
      <View style={s.chips} accessibilityRole="tablist">
        {ACTIVITY_FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
      </View>
      {entries.length === 0 ? (
        <EmptyState
          icon="clock.arrow.circlepath"
          title={filter === 'all' ? 'No activity' : 'No matching entries'}
          message={filter === 'all' ? 'The server has no activity to show.' : q.hasNextPage ? 'None in the entries that are loaded. Load more to look further back.' : 'None in the log.'}
        />
      ) : (
        <View style={s.card}>
          {entries.map((e, i) => (
            <Entry key={e.Id ?? i} entry={e} last={i === entries.length - 1} />
          ))}
        </View>
      )}
      <Text style={s.count}>{`${loaded} of ${total} entries loaded`}</Text>
      {q.isFetchNextPageError ? <ErrorState compact error={q.error} onRetry={() => void q.fetchNextPage()} /> : null}
      {q.hasNextPage ? <Button title="Load more" variant="tonal" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
    </View>
  );
}

function Entry({ entry: e, last }: { entry: ActivityLogEntry; last: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const bad = e.Severity === 'Error' || e.Severity === 'Critical';
  const warn = e.Severity === 'Warning';
  const when = formatSince(e.Date, new Date());
  const exact = e.Date ? new Date(e.Date).toLocaleString() : '';
  return (
    <View style={[s.row, !last && s.border]} accessible accessibilityLabel={`${bad ? 'Error. ' : warn ? 'Warning. ' : ''}${e.Name}. ${e.ShortOverview ?? ''} ${exact}`}>
      <View style={s.icon}>
        <Icon name={bad || warn ? 'exclamationmark.triangle' : entryIcon(e)} size={scaled(iconSize.sm - 1)} color={bad ? c.danger : warn ? c.warning : c.text2} />
      </View>
      <View style={s.text}>
        <Text style={s.name}>{e.Name}</Text>
        {e.ShortOverview ? <Text style={[s.sub, bad && { color: c.danger }]}>{e.ShortOverview}</Text> : null}
        <Text style={s.time}>{`${when ?? ''}${exact ? ` · ${exact}` : ''}`}</Text>
      </View>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  stack: { gap: spacing.lg },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  card: { backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden' as const },
  row: { flexDirection: 'row' as const, gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'flex-start' as const },
  border: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  icon: { width: scaled(29), height: scaled(29), borderRadius: 7, backgroundColor: c.surface2, alignItems: 'center' as const, justifyContent: 'center' as const },
  text: { flex: 1, gap: 2 },
  name: { ...font(type.subheadline), color: c.text },
  sub: { ...font(type.footnote), color: c.text2 },
  time: { ...font(type.caption1, { tabular: true }), color: c.text3 },
  count: { ...font(type.footnote), color: c.text2, textAlign: 'center' as const },
}));
