/**
 * The way from Live TV to the provider's Films and Series: two chips under
 * the Live TV toolbar. Kept in its own file so the Live TV page only mounts
 * it (the page's layout is its own concern).
 */
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { Chip, chipRowTV } from '@/components/chip';
import { useVodKinds } from '@/iptv';
import { createStyles, type AppTheme, spacing, useLayout, useStyles } from '@/theme';

import { useLiveGroup } from '../nav';
import { vodHomeHref } from './vod-nav';

export function VodEntries({ providerId }: { providerId: string | null }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const group = useLiveGroup();
  const kinds = useVodKinds(providerId);
  if (!providerId || (!kinds.film && !kinds.series)) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.row} contentContainerStyle={[s.content, chipRowTV(), { paddingHorizontal: l.gutter }]}>
      {kinds.film ? <Chip label="Films" icon="film" onPress={() => router.push(vodHomeHref(group, 'film', providerId))} /> : null}
      {kinds.series ? <Chip label="Series" icon="tv" onPress={() => router.push(vodHomeHref(group, 'series', providerId))} /> : null}
    </ScrollView>
  );
}

const makeStyles = createStyles((_: AppTheme) => ({
  row: { flexGrow: 0 },
  content: { gap: spacing.sm, paddingVertical: spacing.xs },
}));
