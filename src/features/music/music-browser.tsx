import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo } from 'react';

import type { MusicTab } from '@/api/jellyfin';
import { useMusicTab } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, GridSkeleton, LoadingState } from '@/components/states';
import { TabPager } from '@/components/tab-pager';
import type { PagerTab } from '@/components/tab-pager-types';
import { ArtistRow, TrackRow } from '@/features/detail/rows';
import { type TabGroup, useOpenItem, useTabGroup } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { usePlayer } from '@/player';
import { storage } from '@/storage/kv';
import { spacing } from '@/theme';

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

const listStyle = { paddingBottom: spacing.huge * 2, paddingTop: spacing.sm };

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
  const open = useOpenItem();
  const pull = usePullRefresh(q.refetch);
  const more = () => {
    if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
  };

  if (q.isPending) return tab === 'songs' || tab === 'artists' ? <LoadingState /> : <GridSkeleton shape="square" />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;

  const empty = <EmptyState icon="music.note" title={EMPTY[tab]} />;

  if (tab === 'songs' || tab === 'artists') {
    return (
      <FlashList
        data={items}
        keyExtractor={(it, i) => it.Id ?? String(i)}
        renderItem={({ item, index }) =>
          tab === 'songs' ? (
            <TrackRow item={item} index={index} showArt last={index === items.length - 1} onPress={(song) => player.play({ item: song })} />
          ) : (
            <ArtistRow item={item} last={index === items.length - 1} onPress={open} />
          )
        }
        onEndReached={more}
        onEndReachedThreshold={0.8}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        ListEmptyComponent={empty}
        contentContainerStyle={listStyle}
      />
    );
  }

  return (
    <ItemGrid
      items={items}
      shape="square"
      autoInset={false}
      onEndReached={more}
      isFetchingMore={q.isFetchingNextPage}
      onRefresh={q.refetch}
      ListEmptyComponent={empty}
      onPress={tab === 'genres' ? (g) => router.push(genreHref(group, g, libraryId)) : undefined}
    />
  );
}

