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

export interface PlayerController {
  /** False when no engine can play the item kind yet. */
  readonly available: boolean;
  play(request: PlayRequest): void;
  /** Audio: put the item (or a container's tracks) after the current track. */
  playNext(item: BaseItemDto): void;
  /** Audio: add the item (or a container's tracks) at the end of Up next. */
  addToQueue(item: BaseItemDto): void;
  /** Audio: play an Instant Mix built from a song, album, artist, playlist or genre. */
  instantMix(item: BaseItemDto): void;
}
