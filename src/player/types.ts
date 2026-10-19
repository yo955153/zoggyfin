import type { BaseItemDto } from '@/api/types';

/** What a screen asks the player for. */
export interface PlayRequest {
  item: BaseItemDto;
  /** Items to queue after `item` (album tracks, next episodes). */
  queue?: BaseItemDto[];
  /**
   * Where to start. Leave it out to resume from the saved position;
   * pass 0 to start over.
   */
  startPositionTicks?: number;
}

export interface PlayerController {
  /** False when no engine can play the item kind yet. */
  readonly available: boolean;
  play(request: PlayRequest): void;
}
