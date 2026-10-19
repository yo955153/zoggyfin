/**
 * Built-in item actions. They register through the same registry that any
 * later contributor uses.
 */
import { itemActions } from '@/registry/item-actions';

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Audio', 'AudioBook', 'MusicAlbum', 'Playlist', 'Series', 'Season', 'BoxSet']);
const WATCHABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Series', 'Season', 'BoxSet']);

let registered = false;

export function registerBuiltinItemActions(): void {
  if (registered) return;
  registered = true;

  itemActions.register({
    id: 'builtin.play',
    title: 'Play',
    icon: 'play.fill',
    order: 10,
    when: ({ item }) => PLAYABLE.has(item.Type ?? ''),
    run: ({ item, app }) => app.play(item),
  });
  itemActions.register({
    id: 'builtin.favorite',
    title: 'Add to favourites',
    icon: 'heart',
    order: 20,
    when: ({ item }) => !!item.Id && !item.UserData?.IsFavorite,
    run: ({ item, app }) => app.setFavorite(item, true),
  });
  itemActions.register({
    id: 'builtin.unfavorite',
    title: 'Remove from favourites',
    icon: 'heart.fill',
    order: 20,
    when: ({ item }) => !!item.Id && !!item.UserData?.IsFavorite,
    run: ({ item, app }) => app.setFavorite(item, false),
  });
  itemActions.register({
    id: 'builtin.played',
    title: 'Mark as played',
    icon: 'checkmark.circle.fill',
    order: 30,
    when: ({ item }) => WATCHABLE.has(item.Type ?? '') && !item.UserData?.Played,
    run: ({ item, app }) => app.setPlayed(item, true),
  });
  itemActions.register({
    id: 'builtin.unplayed',
    title: 'Mark as unplayed',
    icon: 'circle',
    order: 30,
    when: ({ item }) => WATCHABLE.has(item.Type ?? '') && !!item.UserData?.Played,
    run: ({ item, app }) => app.setPlayed(item, false),
  });
  itemActions.register({
    id: 'builtin.goToSeries',
    title: 'Go to show',
    icon: 'tv',
    order: 40,
    when: ({ item }) => (item.Type === 'Episode' || item.Type === 'Season') && !!item.SeriesId,
    run: ({ item, app }) => app.openItem({ Id: item.SeriesId ?? '', Type: 'Series', Name: item.SeriesName }),
  });
  itemActions.register({
    id: 'builtin.goToAlbum',
    title: 'Go to album',
    icon: 'square.stack',
    order: 40,
    when: ({ item }) => item.Type === 'Audio' && !!item.AlbumId,
    run: ({ item, app }) => app.openItem({ Id: item.AlbumId ?? '', Type: 'MusicAlbum', Name: item.Album }),
  });
  itemActions.register({
    id: 'builtin.goToArtist',
    title: 'Go to artist',
    icon: 'music.mic',
    order: 41,
    when: ({ item }) => (item.Type === 'Audio' || item.Type === 'MusicAlbum') && !!item.AlbumArtists?.[0]?.Id,
    run: ({ item, app }) => {
      const a = item.AlbumArtists?.[0];
      app.openItem({ Id: a?.Id ?? '', Type: 'MusicArtist', Name: a?.Name });
    },
  });
}
