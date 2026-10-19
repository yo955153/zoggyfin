/**
 * Built-in Home sections. They register through the Home section registry,
 * the same way later contributors will.
 */
import { router } from 'expo-router';

import { useLatest, useNextUp, useResume, useViews } from '@/api/queries';
import { downloadsSupported, useDownloadLists } from '@/downloads';
import { useServerNames } from '@/features/servers/use-server-names';
import { useOffline } from '@/lib/online';
import type { BaseItemDto } from '@/api/types';
import { ItemRow } from '@/components/item-row';
import { EmptyState } from '@/components/states';
import { shapeForList } from '@/components/tile';
import { isSupportedView } from '@/features/library/library-kind';
import { episodeLabel } from '@/lib/format';
import { itemHref, useTabGroup } from '@/lib/navigation';
import { homeSections } from '@/registry/home-sections';

const episodeSubtitle = (item: BaseItemDto) =>
  item.Type === 'Episode' ? [episodeLabel(item), item.Name].filter(Boolean).join(' · ') : undefined;

function ContinueWatching() {
  const q = useResume('Video');
  return (
    <ItemRow
      title="Continue watching"
      shape="thumb"
      titleOnArt
      items={q.data}
      isLoading={q.isPending}
      error={q.error}
      onRetry={q.refetch}
      tileSubtitle={episodeSubtitle}
    />
  );
}

function NextUp() {
  const q = useNextUp();
  return (
    <ItemRow
      title="Next up"
      shape="thumb"
      items={q.data}
      isLoading={q.isPending}
      error={q.error}
      onRetry={q.refetch}
      tileSubtitle={episodeSubtitle}
    />
  );
}

function ContinueListening() {
  const q = useResume('Audio');
  return (
    <ItemRow title="Continue listening" shape="square" items={q.data} isLoading={q.isPending} error={q.error} onRetry={q.refetch} />
  );
}

function LatestRow({ view }: { view: BaseItemDto }) {
  const q = useLatest(view.Id ?? '');
  const group = useTabGroup();
  const shape =
    view.CollectionType === 'music' ? 'square' : shapeForList(q.data, view.CollectionType === 'homevideos' ? 'thumb' : 'poster');
  return (
    <ItemRow
      title={`Recently added in ${view.Name ?? 'Library'}`}
      shape={shape}
      items={q.data}
      isLoading={q.isPending}
      error={q.error}
      onRetry={q.refetch}
      onSeeAll={() => {
        const href = itemHref(group, view);
        if (href) router.push(href);
      }}
    />
  );
}

function RecentlyAdded() {
  const views = useViews();
  if (views.error && !views.data) {
    return <ItemRow title="Recently added" shape="poster" items={undefined} error={views.error} onRetry={views.refetch} />;
  }
  if (views.data && views.data.filter(isSupportedView).length === 0) {
    return <EmptyState icon="square.stack" title="No libraries yet" message="Add a library on the server, then pull to refresh." />;
  }
  return (
    <>
      {(views.data ?? [])
        .filter((v) => isSupportedView(v) && v.CollectionType !== 'playlists' && v.CollectionType !== 'boxsets')
        .map((v) => (
          <LatestRow key={v.Id} view={v} />
        ))}
    </>
  );
}

/** Downloads on this device as tiles: the album, the show or the movie, from every saved server. */
function DownloadedRow() {
  const { sections } = useDownloadLists();
  const nameOf = useServerNames();
  const groups = sections.flatMap((sec) => sec.groups);
  const items = groups.map((g) => g.item);
  if (!downloadsSupported || !items.length) return null;
  const many = sections.length > 1;
  return (
    <ItemRow
      title="Downloads"
      shape={shapeForList(items, 'poster')}
      items={items}
      onSeeAll={() => router.navigate('/(tabs)/(saved)/downloads')}
      tileSubtitle={(it) => {
        const g = groups.find((x) => x.id === it.Id);
        const count = g && g.records.length > 1 ? `${g.records.length} ${g.type === 'Series' ? 'episodes' : 'songs'}` : null;
        // With downloads from more than one server, each tile names its server.
        return [count, many && g ? nameOf(g.serverId) : null].filter(Boolean).join(' · ') || undefined;
      }}
    />
  );
}

/** Offline: the downloads come first, since they are what plays. */
function DownloadedFirst() {
  return useOffline() ? <DownloadedRow /> : null;
}

function DownloadedLast() {
  return useOffline() ? null : <DownloadedRow />;
}

let registered = false;

export function registerBuiltinHomeSections(): void {
  if (registered) return;
  registered = true;
  homeSections.register({ id: 'builtin.downloadedOffline', order: 5, component: DownloadedFirst });
  homeSections.register({ id: 'builtin.continueWatching', order: 10, component: ContinueWatching });
  homeSections.register({ id: 'builtin.nextUp', order: 20, component: NextUp });
  homeSections.register({ id: 'builtin.continueListening', order: 30, component: ContinueListening });
  homeSections.register({ id: 'builtin.recentlyAdded', order: 40, component: RecentlyAdded });
  homeSections.register({ id: 'builtin.downloaded', order: 50, component: DownloadedLast });
}
