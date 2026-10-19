/**
 * The part of an item the audio queue keeps. Queues are saved to storage,
 * so they carry only what the player, the queue rows and the lock screen use.
 */
import type { BaseItemDto } from '@/api/types';

export type AudioItem = BaseItemDto & { Id: string };

export function isAudioItemLike(v: unknown): v is AudioItem {
  return !!v && typeof v === 'object' && typeof (v as { Id?: unknown }).Id === 'string';
}

export function slimItem(item: BaseItemDto): AudioItem {
  const primary = item.ImageTags?.Primary;
  const source = item.MediaSources?.[0];
  const streams = source?.MediaStreams ?? item.MediaStreams ?? [];
  const audio = streams.find((s) => s.Type === 'Audio');
  const lyricStream = streams.some((s) => s.Type === 'Lyric');
  return {
    Id: item.Id ?? '',
    ServerId: item.ServerId,
    Name: item.Name,
    Type: item.Type,
    MediaType: item.MediaType,
    RunTimeTicks: item.RunTimeTicks,
    // Kept so the player asks for lyrics only when they exist (see lyrics.ts).
    HasLyrics: lyricStream ? true : item.HasLyrics,
    IndexNumber: item.IndexNumber,
    ParentIndexNumber: item.ParentIndexNumber,
    ParentId: item.ParentId,
    Album: item.Album,
    AlbumId: item.AlbumId,
    AlbumArtist: item.AlbumArtist,
    AlbumArtists: item.AlbumArtists?.slice(0, 3),
    Artists: item.Artists?.slice(0, 5),
    ArtistItems: item.ArtistItems?.slice(0, 3),
    Genres: item.Genres?.slice(0, 5),
    ProductionYear: item.ProductionYear,
    Container: item.Container ?? source?.Container,
    ImageTags: primary ? { Primary: primary } : undefined,
    ImageBlurHashes: primary && item.ImageBlurHashes?.Primary?.[primary]
      ? { Primary: { [primary]: item.ImageBlurHashes.Primary[primary] as string } }
      : undefined,
    AlbumPrimaryImageTag: item.AlbumPrimaryImageTag,
    ParentBackdropItemId: item.ParentBackdropItemId,
    ParentBackdropImageTags: item.ParentBackdropImageTags?.slice(0, 1),
    Chapters: item.Chapters?.map((c) => ({ Name: c.Name, StartPositionTicks: c.StartPositionTicks })),
    MediaSources: source
      ? [
          {
            Id: source.Id,
            Container: source.Container,
            Bitrate: source.Bitrate,
            MediaStreams: audio
              ? [{ Type: 'Audio', Codec: audio.Codec, BitRate: audio.BitRate, BitDepth: audio.BitDepth, SampleRate: audio.SampleRate, Channels: audio.Channels }]
              : [],
          },
        ]
      : undefined,
    UserData: item.UserData
      ? {
          IsFavorite: item.UserData.IsFavorite,
          Played: item.UserData.Played,
          PlaybackPositionTicks: item.UserData.PlaybackPositionTicks,
          PlayCount: item.UserData.PlayCount,
          Key: item.UserData.Key ?? '',
          ItemId: item.UserData.ItemId ?? '',
        }
      : undefined,
  };
}

/** "Artist" for a row or the lock screen. */
export function artistLine(item: BaseItemDto): string | null {
  return item.Artists?.filter(Boolean).join(', ') || item.AlbumArtist || null;
}
