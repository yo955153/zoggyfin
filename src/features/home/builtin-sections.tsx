/**
 * Built-in Home sections. They register through the Home section registry,
 * the same way later contributors will.
 */
import { router } from 'expo-router';

import { useLatest, useNextUp, useResume, useViews } from '@/api/queries';
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

let registered = false;

export function registerBuiltinHomeSections(): void {
  if (registered) return;
  registered = true;
  homeSections.register({ id: 'builtin.continueWatching', order: 10, component: ContinueWatching });
  homeSections.register({ id: 'builtin.nextUp', order: 20, component: NextUp });
  homeSections.register({ id: 'builtin.continueListening', order: 30, component: ContinueListening });
  homeSections.register({ id: 'builtin.recentlyAdded', order: 40, component: RecentlyAdded });
}
