/**
 * Generated art: the last image fallback. A gradient seeded from the title,
 * the title text and an icon for the item type. It is deterministic, so a
 * tile looks the same on every render and every device.
 */

export interface GeneratedArt {
  /** Two gradient colors, top-left to bottom-right. */
  colors: [string, string];
  /** An SF Symbol name for the item type. */
  icon: string;
  /** The text to show on the tile. */
  title: string;
}

/** FNV-1a 32 bit. Small, fast and stable across platforms. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h) % 360}, ${s}%, ${l}%)`;
}

const ICONS: Record<string, string> = {
  Movie: 'film',
  Video: 'film',
  Trailer: 'film',
  Series: 'tv',
  Season: 'tv',
  Episode: 'tv',
  MusicAlbum: 'square.stack',
  Audio: 'music.note',
  AudioBook: 'book',
  Book: 'book',
  MusicArtist: 'music.mic',
  Person: 'person.fill',
  Playlist: 'music.note.list',
  BoxSet: 'square.stack.3d.up',
  MusicGenre: 'guitars',
  Genre: 'theatermasks',
  CollectionFolder: 'folder',
  UserView: 'folder',
  Folder: 'folder',
  Channel: 'antenna.radiowaves.left.and.right',
  TvChannel: 'antenna.radiowaves.left.and.right',
  LiveTvChannel: 'antenna.radiowaves.left.and.right',
};

const COLLECTION_ICONS: Record<string, string> = {
  movies: 'film',
  tvshows: 'tv',
  music: 'music.note',
  books: 'book',
  boxsets: 'square.stack.3d.up',
  playlists: 'music.note.list',
  homevideos: 'video',
  photos: 'photo',
  livetv: 'antenna.radiowaves.left.and.right',
  musicvideos: 'music.note.tv',
};

export function iconForType(type?: string | null, collectionType?: string | null): string {
  if (collectionType && COLLECTION_ICONS[collectionType]) return COLLECTION_ICONS[collectionType];
  if (type && ICONS[type]) return ICONS[type];
  return 'square.grid.2x2';
}

export function generatedArt(
  title: string | null | undefined,
  type?: string | null,
  collectionType?: string | null,
): GeneratedArt {
  const text = (title ?? '').trim() || 'Untitled';
  const hash = hashString(text);
  const hue = hash % 360;
  // A neighbour hue for the second stop keeps the gradient calm.
  const hue2 = hue + 30 + ((hash >>> 9) % 40);
  const sat = 45 + ((hash >>> 17) % 20);
  return {
    colors: [hsl(hue, sat, 34), hsl(hue2, sat, 18)],
    icon: iconForType(type, collectionType),
    title: text,
  };
}
