/**
 * The page of an IPTV film: the details from the provider, Play or Resume
 * (the position this device saved), Start over and Favourite.
 */
import { ActivityIndicator, Text, View } from 'react-native';

import { type Film, isVodFavourite, playedFractionOf, positionOf, resumeAt, useActiveProviderId, useVodInfo, useVodLists, useVodPlayer, useVodTitle, vod } from '@/iptv';
import { formatClock } from '@/lib/format';
import { toast } from '@/lib/toast';
import { createStyles, type AppTheme, font, spacing, type, useStyles, useTheme } from '@/theme';

import { type VodAction, VodDetail } from './vod-detail';
import { factsOf } from './vod-view';

export function FilmDetailScreen({ id, providerId: wanted }: { id: string; providerId?: string }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const active = useActiveProviderId();
  const pid = wanted || active;
  const item = useVodTitle(pid, 'film', id);
  const info = useVodInfo(pid, 'film', id);
  const lists = useVodLists(pid);
  const player = useVodPlayer();
  const details = info.data;
  // Opened with no catalogue loaded (a restart on this page): the details have the name and the file type.
  const film: Film | null = item ?? (details?.name ? { id, name: details.name, categoryId: '', streamId: /^\d+$/.test(id) ? Number(id) : undefined, ...(details.ext ? { ext: details.ext } : {}) } : null);
  const name = film?.name ?? '';
  const resume = resumeAt(lists, 'film', id);
  const progress = playedFractionOf(positionOf(lists, 'film', id));
  const favourite = isVodFavourite(lists, 'film', id);
  const poster = film?.poster ?? details?.poster ?? null;

  if (!film) {
    return (
      <View style={s.center}>
        {info.status === 'error' ? <Text style={s.text}>{info.error ?? 'This film did not load.'}</Text> : <ActivityIndicator color={c.text2} />}
      </View>
    );
  }

  const play = (start: number) => pid && player.playFilm(pid, film, details, start);
  const actions: VodAction[] = [];
  if (resume > 0) actions.push({ icon: 'arrow.counterclockwise', label: 'Start over', onPress: () => play(0) });
  actions.push({
    icon: favourite ? 'heart.fill' : 'heart',
    label: 'Favourite',
    active: favourite,
    onPress: () => {
      if (!pid) return;
      const on = vod.toggleFavourite(pid, { kind: 'film', id, name, ...(poster ? { poster } : {}) });
      toast(on ? `${name} is in Favourites` : `${name} is no longer in Favourites`, { icon: on ? 'heart.fill' : 'heart' });
    },
  });

  const credits = [details?.director ? `Director: ${details.director}` : null, details?.cast ? `Cast: ${details.cast}` : null].filter((x): x is string => !!x);
  const status =
    info.status === 'loading' && !details ? (
      <ActivityIndicator color={c.text2} style={s.spinner} />
    ) : info.status === 'error' && !details ? (
      <Text style={s.text}>{`The details did not load. ${info.error ?? ''}`.trim()}</Text>
    ) : null;

  return (
    <VodDetail
      kind="film"
      id={id}
      title={name}
      poster={poster}
      backdrop={details?.backdrop ?? null}
      facts={factsOf('film', film, details)}
      overview={details?.plot}
      credits={credits}
      primary={{ label: resume > 0 ? `Resume ${formatClock(resume * 10_000_000) ?? ''}`.trim() : 'Play', onPress: () => play(resume), progress }}
      actions={actions}
      status={status}
    />
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: spacing.xxl, backgroundColor: c.bg },
  text: { ...font(type.footnote), color: c.text2 },
  spinner: { alignSelf: 'flex-start' as const },
}));
