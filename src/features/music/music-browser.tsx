import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MusicTab } from '@/api/jellyfin';
import { useMusicTab } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { TabPager } from '@/components/tab-pager';
import type { PagerTab } from '@/components/tab-pager-types';
import { TrackRow } from '@/features/detail/rows';
import { type TabGroup, useTabGroup } from '@/lib/navigation';
import { usePlayer } from '@/player';
import { storage } from '@/storage/kv';
import { colors, size, spacing } from '@/theme';

const TABS: (PagerTab & { key: MusicTab })[] = [
  { key: 'albums', title: 'Albums' },
  { key: 'artists', title: 'Artists' },
  { key: 'playlists', title: 'Playlists' },
  { key: 'songs', title: 'Songs' },
  { key: 'genres', title: 'Genres' },
];

const EMPTY: Record<MusicTab, string> = {
  albums: 'No albums',
  artists: 'No artists',
  playlists: 'No playlists yet',
  songs: 'No songs',
  genres: 'No genres',
};

/** Albums / Artists / Playlists / Songs / Genres, as a pager that follows a horizontal swipe. */
export function MusicBrowser({ libraryId }: { libraryId: string }) {
  const lastKey = `music.tab.${libraryId}`;
  const initial = Math.max(0, TABS.findIndex((t) => t.key === storage.getString(lastKey)));
  return (
    <TabPager
      tabs={TABS}
      initialIndex={initial}
      onIndexChange={(i) => storage.set(lastKey, TABS[i].key)}
      renderPage={(tab) => <MusicPage libraryId={libraryId} tab={tab.key as MusicTab} />}
    />
  );
}

function genreHref(group: TabGroup, genre: BaseItemDto, libraryId: string) {
  return {
    pathname: `/(tabs)/${group}/genre/[id]`,
    params: { id: genre.Id ?? '', name: genre.Name ?? '', libraryId },
  } as unknown as Parameters<typeof router.push>[0];
}

function MusicPage({ libraryId, tab }: { libraryId: string; tab: MusicTab }) {
  const q = useMusicTab(libraryId, tab);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const group = useTabGroup();
  const player = usePlayer();
  const more = () => {
    if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
  };

  if (q.isPending) return <LoadingState />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;

  const empty = <EmptyState icon="music.note" title={EMPTY[tab]} />;

  if (tab === 'songs') {
    return (
      <FlashList
        data={items}
        keyExtractor={(it, i) => it.Id ?? String(i)}
        renderItem={({ item, index }) => (
          <TrackRow item={item} index={index} showArt onPress={(song) => player.play({ item: song })} />
        )}
        onEndReached={more}
        onEndReachedThreshold={0.8}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={q.refetch}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
      />
    );
  }

  return (
    <ItemGrid
      items={items}
      shape={tab === 'artists' ? 'circle' : 'square'}
      autoInset={false}
      onEndReached={more}
      isFetchingMore={q.isFetchingNextPage}
      refreshing={q.isRefetching && !q.isFetchingNextPage}
      onRefresh={q.refetch}
      ListEmptyComponent={empty}
      onPress={tab === 'genres' ? (g) => router.push(genreHref(group, g, libraryId)) : undefined}
    />
  );
}

function Separator() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xxl * 2, paddingTop: spacing.sm },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: size.songSeparatorInset },
});
