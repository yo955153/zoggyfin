import type { BaseItemDto } from '@/api/types';

/** What a screen asks the player for. */
export interface PlayRequest {
  item: BaseItemDto;
  /** Items to queue after `item` (album tracks, next episodes). */
  queue?: BaseItemDto[];
  /**
   * Audio: the whole list (album tracks, playlist entries) with `index`
   * pointing at `item`, so Previous and the queue know what came before.
   */
  list?: BaseItemDto[];
  index?: number;
  /** Audio: the album, playlist or artist the list comes from ("Playing from"). */
  context?: BaseItemDto;
  /** Audio: shuffle the list. */
  shuffle?: boolean;
  /**
   * Where to start. Leave it out to resume from the saved position;
   * pass 0 to start over.
   */
  startPositionTicks?: number;
  /** Video: false loads the item paused (watch together starts it for the group). */
  autoplay?: boolean;
}

/** A channel the live player can switch to. */
export interface LiveChannelRef {
  id: string;
  name: string;
  logo: string | null;
  number: number | null;
  group: string;
}

/** A stream to try for a live channel. */
export interface LiveStreamChoice {
  url: string;
  isHls: boolean;
  /** iOS: play the progressive MPEG-TS `url` through the TS bridge (`@/native/ts-bridge`). */
  bridge?: boolean;
}

/**
 * Where live channels come from (an IPTV provider). The player knows no
 * provider: it asks the source for the streams of a channel.
 */
export interface LiveSource {
  providerId: string;
  /** The streams to try, in order. Never throws: on failure, no candidates and a message. */
  resolve(channelId: string): Promise<{ candidates: LiveStreamChoice[]; userAgent: string | null; unsupported: string | null }>;
  /** The programme that runs now on the channel, or null. */
  nowLine?(channelId: string): string | null;
  /** A channel started to play (Recently watched). */
  onStart?(channelId: string): void;
}

/** What a screen asks the player for to play a live stream: no Jellyfin item, no progress reports. */
export interface LivePlayRequest {
  /** The channels that channel up and down move through (the list the user played from). */
  channels: LiveChannelRef[];
  index: number;
  source: LiveSource;
}

export interface PlayerController {
  /** False when no engine can play the item kind yet. */
  readonly available: boolean;
  play(request: PlayRequest): void;
  /** Plays a live channel. Not in a watch-together session (it says so). */
  playLive(request: LivePlayRequest): void;
  /** Audio: put the item (or a container's tracks) after the current track. */
  playNext(item: BaseItemDto): void;
  /** Audio: add the item (or a container's tracks) at the end of Up next. */
  addToQueue(item: BaseItemDto): void;
  /** Audio: play an Instant Mix built from a song, album, artist, playlist or genre. */
  instantMix(item: BaseItemDto): void;
}
