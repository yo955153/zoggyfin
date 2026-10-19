import type { BaseItemDto } from '@/api/types';

export type LibraryKind = 'movies' | 'tvshows' | 'music' | 'boxsets' | 'playlists' | 'mixed' | 'other';

export function libraryKind(view: Pick<BaseItemDto, 'CollectionType'>): LibraryKind {
  switch (view.CollectionType) {
    case 'movies':
      return 'movies';
    case 'tvshows':
      return 'tvshows';
    case 'music':
      return 'music';
    case 'boxsets':
      return 'boxsets';
    case 'playlists':
      return 'playlists';
    case undefined:
    case null:
      return 'mixed';
    default:
      return 'other';
  }
}

/** The item types a library grid lists. */
export function gridItemTypes(kind: LibraryKind): string[] {
  switch (kind) {
    case 'movies':
      return ['Movie'];
    case 'tvshows':
      return ['Series'];
    case 'boxsets':
      return ['BoxSet'];
    case 'playlists':
      return ['Playlist'];
    case 'music':
      return ['MusicAlbum'];
    case 'mixed':
      return ['Movie', 'Series'];
    default:
      return ['Movie', 'Series', 'Video', 'MusicVideo', 'BoxSet'];
  }
}

/** Libraries the app can show. Live TV and channels are out of scope for now. */
export function isSupportedView(view: Pick<BaseItemDto, 'CollectionType' | 'Type'>): boolean {
  if (view.CollectionType === 'livetv') return false;
  if (view.Type === 'Channel') return false;
  return true;
}

/**
 * Libraries that open in the Music tab. Recitations and other spoken-word
 * audio usually live in a "music" library too. Audiobook libraries have the
 * "books" collection type (the SDK has no audiobooks type); they open with
 * the Audiobooks and Authors tabs and the long-form player.
 */
export function isAudioView(view: Pick<BaseItemDto, 'CollectionType'>): boolean {
  return view.CollectionType === 'music' || view.CollectionType === 'books';
}

export function audioLibraryKind(view: Pick<BaseItemDto, 'CollectionType'>): 'music' | 'books' {
  return view.CollectionType === 'books' ? 'books' : 'music';
}
