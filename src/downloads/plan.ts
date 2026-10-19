/**
 * What to download for an item, and from which URL. Pure, so the rules are
 * unit-tested:
 *   - Video: the original file when the device profile can direct-play it
 *     and it fits the download quality; else a server transcode (progressive
 *     MP4, H.264/AAC) at the download quality.
 *   - Audio: the universal endpoint, which gives the original file when it
 *     can play here and an MP3 transcode when it cannot.
 */
import type { BaseItemDto, DeviceProfile } from '@/api/types';
import { predictPlayMethod, universalAudioUrl } from '@/player/audio/stream-url';
import { absolute, type MediaSource, type StreamServer, withStreamAuth } from '@/player/stream';

import type { DownloadGroup, DownloadQuality, MediaKind } from './types';

export const DOWNLOAD_QUALITY_OPTIONS: readonly { value: DownloadQuality; label: string }[] = [
  { value: 0, label: 'Original' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
];

/** Video bitrate for a transcoded download, by maximum height. */
export function transcodeBitrate(quality: DownloadQuality): number {
  switch (quality) {
    case 480:
      return 1_500_000;
    case 720:
      return 4_000_000;
    case 1080:
      return 8_000_000;
    default:
      return 20_000_000;
  }
}

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);
const AUDIO_TYPES = new Set(['Audio', 'AudioBook']);
/** Containers whose items are downloaded one by one. */
export const CONTAINER_TYPES = new Set(['MusicAlbum', 'Playlist', 'Season', 'Series', 'BoxSet', 'Folder']);

export function mediaKindOf(item: Pick<BaseItemDto, 'Type' | 'MediaType'>): MediaKind | null {
  if (VIDEO_TYPES.has(item.Type ?? '')) return 'video';
  if (AUDIO_TYPES.has(item.Type ?? '')) return 'audio';
  if (item.MediaType === 'Video') return 'video';
  if (item.MediaType === 'Audio') return 'audio';
  return null;
}

/** True for items and containers that the download button applies to. */
export function isDownloadable(item: Pick<BaseItemDto, 'Type' | 'MediaType' | 'Id'>): boolean {
  if (!item.Id) return false;
  return mediaKindOf(item) !== null || CONTAINER_TYPES.has(item.Type ?? '');
}

export function isContainer(item: Pick<BaseItemDto, 'Type'>): boolean {
  return CONTAINER_TYPES.has(item.Type ?? '');
}

/** The Downloaded list groups episodes by show and songs by album; the rest stand alone. */
export function groupFor(item: BaseItemDto): DownloadGroup {
  if (item.Type === 'Episode' && item.SeriesId) {
    return { id: item.SeriesId, name: item.SeriesName ?? 'Show', type: 'Series' };
  }
  if ((item.Type === 'Audio' || item.Type === 'AudioBook') && item.AlbumId) {
    return { id: item.AlbumId, name: item.Album ?? 'Album', type: 'MusicAlbum' };
  }
  return { id: item.Id ?? '', name: item.Name ?? 'Item', type: 'Single' };
}

/** Order inside a group: season then episode, disc then track. */
export function sortFor(item: BaseItemDto): number {
  const outer = item.ParentIndexNumber ?? 0;
  const inner = item.IndexNumber ?? 0;
  return item.Type === 'Episode' ? outer * 10_000 + inner : outer * 1_000 + inner;
}

/** The first extension of a container list: "mov,mp4,m4a" → "mov". */
export function extensionOf(container: string | null | undefined, fallback: string): string {
  const first = (container ?? '').split(',')[0]?.trim().toLowerCase();
  if (!first || !/^[a-z0-9]{2,5}$/.test(first)) return fallback;
  return first === 'mpeg' ? 'mpg' : first;
}

function query(params: Record<string, string | number | undefined | null>): string {
  return Object.entries(params)
    .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== null && e[1] !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export interface MediaPlan {
  url: string;
  method: 'original' | 'transcode';
  /** File name in the item folder. */
  file: string;
  mediaSourceId: string;
  /** The server's size for an original file, or an estimate for a transcode. */
  expectedBytes: number | null;
}

function videoHeight(source: MediaSource): number {
  return source.MediaStreams?.find((s) => s.Type === 'Video')?.Height ?? 0;
}

/**
 * The video plan for a media source that came back from PlaybackInfo with
 * our device profile. `SupportsDirectPlay` there means the file opens on
 * this device as it is.
 */
export function videoPlan(
  server: StreamServer,
  itemId: string,
  source: MediaSource,
  quality: DownloadQuality,
  opts: { playSessionId?: string | null; runTimeTicks?: number | null; audioIndex?: number | null } = {},
): MediaPlan {
  const sourceId = source.Id ?? itemId;
  const height = videoHeight(source);
  const fits = quality === 0 || (height > 0 && height <= quality);
  if (source.SupportsDirectPlay && fits) {
    const ext = extensionOf(source.Container, 'mp4');
    const q = query({ static: 'true', mediaSourceId: sourceId, deviceId: server.deviceId, Tag: source.ETag });
    return {
      url: withStreamAuth(absolute(server.baseUrl, `/Videos/${itemId}/stream.${ext}?${q}`), server.token),
      method: 'original',
      file: `media.${ext}`,
      mediaSourceId: sourceId,
      expectedBytes: source.Size ?? null,
    };
  }
  const bitrate = transcodeBitrate(quality);
  const sourceBitrate = source.Bitrate ?? 0;
  const videoBitRate = sourceBitrate > 0 ? Math.min(bitrate, sourceBitrate) : bitrate;
  const q = query({
    static: 'false',
    mediaSourceId: sourceId,
    deviceId: server.deviceId,
    playSessionId: opts.playSessionId ?? undefined,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    maxAudioChannels: 2,
    audioBitRate: 192_000,
    videoBitRate,
    maxHeight: quality > 0 ? quality : undefined,
    audioStreamIndex: opts.audioIndex ?? undefined,
    subtitleMethod: 'External',
    copyTimestamps: 'false',
    enableAutoStreamCopy: 'true',
  });
  const seconds = opts.runTimeTicks ? opts.runTimeTicks / 10_000_000 : 0;
  return {
    url: withStreamAuth(absolute(server.baseUrl, `/Videos/${itemId}/stream.mp4?${q}`), server.token),
    method: 'transcode',
    file: 'media.mp4',
    mediaSourceId: sourceId,
    expectedBytes: seconds > 0 ? Math.round(((videoBitRate + 192_000) * seconds) / 8) : null,
  };
}

export function audioPlan(server: StreamServer, item: BaseItemDto, profile: DeviceProfile, userId: string, playSessionId: string): MediaPlan {
  const itemId = item.Id ?? '';
  const max = profile.MaxStreamingBitrate ?? 200_000_000;
  const method = predictPlayMethod(item, profile, max) === 'DirectPlay' ? 'original' : 'transcode';
  const source = item.MediaSources?.[0];
  const transcodeExt = profile.TranscodingProfiles?.find((t) => t.Type === 'Audio')?.Container ?? 'mp3';
  const ext = method === 'original' ? extensionOf(source?.Container ?? item.Container, 'mp3') : extensionOf(transcodeExt, 'mp3');
  const seconds = item.RunTimeTicks ? item.RunTimeTicks / 10_000_000 : 0;
  return {
    url: universalAudioUrl(server, itemId, profile, { userId, maxBitrate: max, playSessionId }),
    method,
    file: `media.${ext}`,
    mediaSourceId: source?.Id ?? itemId,
    expectedBytes: method === 'original' ? (source?.Size ?? null) : seconds > 0 ? Math.round((320_000 * seconds) / 8) : null,
  };
}

/** The external text subtitles of a source, as WebVTT URLs to save beside the video. */
export function subtitleFiles(server: StreamServer, itemId: string, source: MediaSource) {
  const sourceId = source.Id ?? itemId;
  return (source.MediaStreams ?? [])
    .filter((s) => s.Type === 'Subtitle' && typeof s.Index === 'number' && s.IsTextSubtitleStream !== false)
    .map((s) => ({
      index: s.Index as number,
      label: s.DisplayTitle || s.Title || s.Language || `Subtitle ${(s.Index as number) + 1}`,
      language: s.Language ?? null,
      isDefault: !!s.IsDefault,
      isForced: !!s.IsForced,
      file: `subtitle-${s.Index as number}.vtt`,
      url: withStreamAuth(
        absolute(server.baseUrl, `/Videos/${itemId}/${sourceId}/Subtitles/${s.Index as number}/0/Stream.vtt`),
        server.token,
      ),
    }));
}

/**
 * The part of an item that is kept with a download: what the item page,
 * the rows, search and both players need with no server.
 */
export function slimForDownload(item: BaseItemDto): BaseItemDto {
  const source = item.MediaSources?.[0];
  const keepStreams = (source?.MediaStreams ?? item.MediaStreams ?? []).map((s) => ({
    Type: s.Type,
    Index: s.Index,
    Codec: s.Codec,
    Language: s.Language,
    DisplayTitle: s.DisplayTitle,
    Title: s.Title,
    IsDefault: s.IsDefault,
    IsForced: s.IsForced,
    IsTextSubtitleStream: s.IsTextSubtitleStream,
    Height: s.Height,
    Width: s.Width,
    BitRate: s.BitRate,
    BitDepth: s.BitDepth,
    SampleRate: s.SampleRate,
    Channels: s.Channels,
    VideoRangeType: s.VideoRangeType,
  }));
  return {
    Id: item.Id,
    ServerId: item.ServerId,
    Name: item.Name,
    OriginalTitle: item.OriginalTitle,
    Type: item.Type,
    MediaType: item.MediaType,
    Overview: item.Overview,
    RunTimeTicks: item.RunTimeTicks,
    HasLyrics: item.HasLyrics,
    ProductionYear: item.ProductionYear,
    PremiereDate: item.PremiereDate,
    OfficialRating: item.OfficialRating,
    CommunityRating: item.CommunityRating,
    Genres: item.Genres?.slice(0, 5),
    IndexNumber: item.IndexNumber,
    ParentIndexNumber: item.ParentIndexNumber,
    ParentId: item.ParentId,
    SeriesId: item.SeriesId,
    SeriesName: item.SeriesName,
    SeasonId: item.SeasonId,
    SeasonName: item.SeasonName,
    Album: item.Album,
    AlbumId: item.AlbumId,
    AlbumArtist: item.AlbumArtist,
    AlbumArtists: item.AlbumArtists?.slice(0, 3),
    Artists: item.Artists?.slice(0, 5),
    ArtistItems: item.ArtistItems?.slice(0, 3),
    Container: item.Container ?? source?.Container,
    ImageTags: item.ImageTags,
    BackdropImageTags: item.BackdropImageTags?.slice(0, 1),
    ImageBlurHashes: item.ImageBlurHashes,
    AlbumPrimaryImageTag: item.AlbumPrimaryImageTag,
    SeriesPrimaryImageTag: item.SeriesPrimaryImageTag,
    ParentBackdropItemId: item.ParentBackdropItemId,
    ParentBackdropImageTags: item.ParentBackdropImageTags?.slice(0, 1),
    ParentThumbItemId: item.ParentThumbItemId,
    ParentThumbImageTag: item.ParentThumbImageTag,
    PrimaryImageAspectRatio: item.PrimaryImageAspectRatio,
    ChildCount: item.ChildCount,
    Chapters: item.Chapters?.map((c) => ({ Name: c.Name, StartPositionTicks: c.StartPositionTicks })),
    MediaStreams: keepStreams,
    MediaSources: source
      ? [{ Id: source.Id, Container: source.Container, Bitrate: source.Bitrate, Size: source.Size, MediaStreams: keepStreams }]
      : undefined,
    UserData: item.UserData
      ? {
          IsFavorite: item.UserData.IsFavorite,
          Played: item.UserData.Played,
          PlaybackPositionTicks: item.UserData.PlaybackPositionTicks,
          PlayedPercentage: item.UserData.PlayedPercentage,
          Key: item.UserData.Key ?? '',
          ItemId: item.UserData.ItemId ?? '',
        }
      : undefined,
  };
}
