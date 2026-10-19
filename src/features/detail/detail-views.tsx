import { StyleSheet, Text, View } from 'react-native';

import { useChildren, useEpisodes, useNextUp, useSeasons, useSimilar } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { ItemRow, RowHeader } from '@/components/item-row';
import { ErrorState, LoadingState } from '@/components/states';
import { episodeLabel, formatDuration } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { usePlayer } from '@/player';
import { colors, GUTTER, size, spacing, type } from '@/theme';

import { DetailScaffold } from './detail-scaffold';
import { EpisodeRow, personToItem, TrackRow } from './rows';

interface ViewProps {
  item: BaseItemDto;
  refreshing: boolean;
  onRefresh: () => void;
}

function year(item: BaseItemDto): string | null {
  return item.ProductionYear ? String(item.ProductionYear) : null;
}

function rating(item: BaseItemDto): string | null {
  return item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null;
}

/** Cast row and "More Like This". Shared by movies, shows and episodes. */
function CastAndSimilar({ item, similar = true }: { item: BaseItemDto; similar?: boolean }) {
  const cast = (item.People ?? []).filter((p) => p.Id).slice(0, 30).map(personToItem);
  const sim = useSimilar(item.Id ?? undefined, similar);
  return (
    <>
      {cast.length ? (
        <ItemRow title="Cast & Crew" shape="circle" items={cast} tileSubtitle={(p) => p.Overview ?? null} />
      ) : null}
      {similar ? (
        <ItemRow title="More Like This" shape="poster" items={sim.data} isLoading={sim.isPending} error={sim.error} onRetry={sim.refetch} />
      ) : null}
    </>
  );
}

function SectionMessage({ children }: { children: string }) {
  return <Text style={styles.message}>{children}</Text>;
}

// ---- Movie / video -------------------------------------------------------------

export function MovieDetail({ item, refreshing, onRefresh }: ViewProps) {
  return (
    <DetailScaffold
      item={item}
      art="poster"
      meta={[year(item), formatDuration(item.RunTimeTicks), item.OfficialRating, rating(item)]}
      playable
      playLabel={item.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={<CastAndSimilar item={item} />}
    />
  );
}

// ---- Series -> seasons ---------------------------------------------------------

export function SeriesDetail({ item, refreshing, onRefresh }: ViewProps) {
  const seasons = useSeasons(item.Id ?? undefined);
  const nextUp = useNextUp(item.Id ?? undefined);
  const next = nextUp.data?.[0];
  return (
    <DetailScaffold
      item={item}
      art="poster"
      meta={[
        year(item),
        item.ChildCount ? `${item.ChildCount} season${item.ChildCount === 1 ? '' : 's'}` : null,
        item.OfficialRating,
        rating(item),
      ]}
      playable
      playLabel={next ? `Play ${episodeLabel(next) ?? ''}`.trim() : 'Play'}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <>
          {next ? <ItemRow title="Next Up" shape="landscape" items={[next]} /> : null}
          {seasons.error && !seasons.data ? (
            <View style={styles.block}>
              <RowHeader title="Seasons" />
              <ErrorState error={seasons.error} onRetry={seasons.refetch} compact />
            </View>
          ) : (
            <ItemRow
              title="Seasons"
              shape="poster"
              items={seasons.data}
              isLoading={seasons.isPending}
              hideWhenEmpty={false}
              tileTitle={(s) => s.Name}
              tileSubtitle={(s) => (s.ChildCount ? `${s.ChildCount} episodes` : null)}
            />
          )}
          <CastAndSimilar item={item} />
        </>
      }
    />
  );
}

// ---- Season -> episodes --------------------------------------------------------

export function SeasonDetail({ item, refreshing, onRefresh }: ViewProps) {
  const seriesId = item.SeriesId ?? item.ParentId ?? undefined;
  const episodes = useEpisodes(seriesId, item.Id ?? undefined);
  const open = useOpenItem();
  return (
    <DetailScaffold
      item={item}
      art="poster"
      eyebrow={item.SeriesName}
      meta={[year(item), episodes.data ? `${episodes.data.length} ${episodes.data.length === 1 ? 'episode' : 'episodes'}` : null]}
      playable
      refreshing={refreshing}
      onRefresh={() => {
        onRefresh();
        episodes.refetch();
      }}
      beforeRows={
        <View style={styles.block}>
          <RowHeader title="Episodes" />
          {episodes.isPending ? <LoadingState style={styles.loading} /> : null}
          {episodes.error && !episodes.data ? <ErrorState error={episodes.error} onRetry={episodes.refetch} compact /> : null}
          {episodes.data && episodes.data.length === 0 ? <SectionMessage>No episodes in this season.</SectionMessage> : null}
        </View>
      }
      rows={episodes.data}
      rowKey={(e, i) => e.Id ?? String(i)}
      renderRow={(e) => <EpisodeRow item={e} onPress={open} />}
    />
  );
}

// ---- Episode ---------------------------------------------------------------------

export function EpisodeDetail({ item, refreshing, onRefresh }: ViewProps) {
  const seriesId = item.SeriesId ?? undefined;
  const episodes = useEpisodes(seriesId, item.SeasonId ?? undefined);
  const others = episodes.data?.filter((e) => e.Id !== item.Id);
  return (
    <DetailScaffold
      item={item}
      art="landscape"
      eyebrow={[item.SeriesName, episodeLabel(item)].filter(Boolean).join(' · ')}
      meta={[formatDuration(item.RunTimeTicks), item.PremiereDate ? new Date(item.PremiereDate).toLocaleDateString() : null, rating(item)]}
      playable
      playLabel={item.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <>
          {others?.length ? (
            <ItemRow
              title={item.SeasonName ?? 'More Episodes'}
              shape="landscape"
              items={others}
              tileTitle={(e) => e.Name}
              tileSubtitle={(e) => episodeLabel(e)}
            />
          ) : null}
          <CastAndSimilar item={item} similar={false} />
        </>
      }
    />
  );
}

// ---- Album / playlist -> tracks -------------------------------------------------

function TrackListDetail({ item, refreshing, onRefresh, kind }: ViewProps & { kind: 'tracks' | 'playlist' }) {
  const tracks = useChildren(item.Id ?? undefined, kind);
  const player = usePlayer();
  const list = tracks.data ?? [];
  const totalTicks = list.reduce((sum, t) => sum + (t.RunTimeTicks ?? 0), 0);
  const isPlaylist = kind === 'playlist';
  const multiDisc = !isPlaylist && new Set(list.map((t) => t.ParentIndexNumber ?? 1)).size > 1;

  return (
    <DetailScaffold
      item={item}
      art="square"
      eyebrow={isPlaylist ? 'Playlist' : item.AlbumArtist ?? item.AlbumArtists?.[0]?.Name}
      meta={[year(item), list.length ? `${list.length} ${list.length === 1 ? 'item' : 'items'}` : null, formatDuration(totalTicks)]}
      playable
      refreshing={refreshing}
      onRefresh={() => {
        onRefresh();
        tracks.refetch();
      }}
      beforeRows={
        <View style={styles.block}>
          {tracks.isPending ? <LoadingState style={styles.loading} /> : null}
          {tracks.error && !tracks.data ? <ErrorState error={tracks.error} onRetry={tracks.refetch} compact /> : null}
          {tracks.data && list.length === 0 ? <SectionMessage>Nothing here yet.</SectionMessage> : null}
        </View>
      }
      rows={list}
      rowKey={(t, i) => t.PlaylistItemId ?? t.Id ?? String(i)}
      renderRow={(t, i) => (
        <>
          {multiDisc && (i === 0 || list[i - 1]?.ParentIndexNumber !== t.ParentIndexNumber) ? (
            <Text style={styles.disc}>Disc {t.ParentIndexNumber ?? 1}</Text>
          ) : null}
          <TrackRow item={t} index={i} showArt={isPlaylist} onPress={(song) => player.play({ item: song, queue: list.slice(i + 1) })} />
        </>
      )}
    />
  );
}

export function AlbumDetail(props: ViewProps) {
  return <TrackListDetail {...props} kind="tracks" />;
}

export function PlaylistDetail(props: ViewProps) {
  return <TrackListDetail {...props} kind="playlist" />;
}

// ---- Artist ------------------------------------------------------------------------

export function ArtistDetail({ item, refreshing, onRefresh }: ViewProps) {
  const albums = useChildren(item.Id ?? undefined, 'artistAlbums');
  const songs = useChildren(item.Id ?? undefined, 'artistSongs');
  const player = usePlayer();
  const songList = songs.data ?? [];
  return (
    <DetailScaffold
      item={item}
      art="circle"
      meta={[albums.data ? `${albums.data.length} album${albums.data.length === 1 ? '' : 's'}` : null]}
      playable
      refreshing={refreshing}
      onRefresh={onRefresh}
      beforeRows={
        <>
          <ItemRow title="Albums" shape="square" items={albums.data} isLoading={albums.isPending} error={albums.error} onRetry={albums.refetch} />
          {songList.length || songs.isPending || songs.error ? (
            <View style={styles.block}>
              <RowHeader title="Songs" />
              {songs.isPending ? <LoadingState style={styles.loading} /> : null}
              {songs.error && !songs.data ? <ErrorState error={songs.error} onRetry={songs.refetch} compact /> : null}
            </View>
          ) : null}
        </>
      }
      rows={songList}
      rowKey={(t, i) => t.Id ?? String(i)}
      renderRow={(t, i) => <TrackRow item={t} index={i} showArt onPress={(song) => player.play({ item: song })} />}
    />
  );
}

// ---- Person ------------------------------------------------------------------------

export function PersonDetail({ item, refreshing, onRefresh }: ViewProps) {
  const titles = useChildren(item.Id ?? undefined, 'personItems');
  const movies = titles.data?.filter((t) => t.Type === 'Movie');
  const shows = titles.data?.filter((t) => t.Type === 'Series');
  const born = item.PremiereDate ? new Date(item.PremiereDate).getFullYear() : null;
  return (
    <DetailScaffold
      item={item}
      art="circle"
      meta={[born ? `Born ${born}` : null, titles.data ? `${titles.data.length} ${titles.data.length === 1 ? 'title' : 'titles'}` : null]}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        titles.error && !titles.data ? (
          <View style={styles.block}>
            <ErrorState error={titles.error} onRetry={titles.refetch} compact />
          </View>
        ) : (
          <>
            <ItemRow title="Movies" shape="poster" items={movies} isLoading={titles.isPending} />
            <ItemRow title="Shows" shape="poster" items={shows} isLoading={titles.isPending} />
            {titles.data && titles.data.length === 0 ? <SectionMessage>No titles in your libraries.</SectionMessage> : null}
          </>
        )
      }
    />
  );
}

// ---- Collection (BoxSet) and folders ------------------------------------------------

export function CollectionDetail({ item, refreshing, onRefresh }: ViewProps) {
  const children = useChildren(item.Id ?? undefined, 'items');
  return (
    <DetailScaffold
      item={item}
      art="poster"
      eyebrow={item.Type === 'BoxSet' ? 'Collection' : undefined}
      meta={[children.data ? `${children.data.length} ${children.data.length === 1 ? 'item' : 'items'}` : null]}
      playable={item.Type === 'BoxSet'}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        children.error && !children.data ? (
          <View style={styles.block}>
            <ErrorState error={children.error} onRetry={children.refetch} compact />
          </View>
        ) : (
          <ItemRow title="Items" shape="poster" items={children.data} isLoading={children.isPending} hideWhenEmpty={false} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.xl },
  loading: { minHeight: size.loadingMinHeight },
  message: { ...type.callout, color: colors.textSecondary, paddingHorizontal: GUTTER, marginTop: spacing.md },
  disc: { ...type.label, color: colors.textSecondary, paddingHorizontal: GUTTER, marginTop: spacing.lg },
});
