import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { itemSeed, logItemTiming } from '@/api/item-seed';
import { useItem } from '@/api/queries';
import { DetailSkeleton, ErrorState } from '@/components/states';
import { useOtherServerDownload } from '@/downloads';
import {
  AlbumDetail,
  ArtistDetail,
  CollectionDetail,
  EpisodeDetail,
  MovieDetail,
  PersonDetail,
  PlaylistDetail,
  SeasonDetail,
  SeriesDetail,
} from '@/features/detail/detail-views';
import { OtherServerDownloadDetail } from '@/features/servers/other-server-detail';
import { detailScreenOptions } from '@/lib/stack-options';

/** One route for every item; the page is picked by the item type. */
export default function ItemScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; type?: string; name?: string }>();
  // A download of another saved server opens from its saved facts, with no server call.
  const other = useOtherServerDownload(id);
  // The tile's item renders the page at once; the full item fills it in.
  const [seed] = useState(() => itemSeed(id));
  const q = useItem(other ? undefined : id, seed);
  const item = other?.item ?? q.data;
  const loaded = !!q.data && !q.isPlaceholderData;
  useEffect(() => logItemTiming(id, 'first render'), [id]);
  useEffect(() => {
    if (loaded) logItemTiming(id, 'data loaded');
  }, [id, loaded]);

  let body;
  if (other) {
    body = <OtherServerDownloadDetail item={other.item} serverId={other.serverId} />;
  } else if (!item) {
    body = q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : <DetailSkeleton />;
  } else {
    const props = { item, onRefresh: q.refetch };
    switch (item.Type) {
      case 'Series':
        body = <SeriesDetail {...props} />;
        break;
      case 'Season':
        body = <SeasonDetail {...props} />;
        break;
      case 'Episode':
        body = <EpisodeDetail {...props} />;
        break;
      case 'MusicAlbum':
        body = <AlbumDetail {...props} />;
        break;
      case 'MusicArtist':
        body = <ArtistDetail {...props} />;
        break;
      case 'Playlist':
        body = <PlaylistDetail {...props} />;
        break;
      case 'Person':
        body = <PersonDetail {...props} />;
        break;
      case 'BoxSet':
      case 'Folder':
      case 'CollectionFolder':
        body = <CollectionDetail {...props} />;
        break;
      default:
        body = <MovieDetail {...props} />;
    }
  }

  return (
    <>
      <Stack.Screen options={{ ...detailScreenOptions, title: item?.Name ?? name ?? '' }} />
      {body}
    </>
  );
}
