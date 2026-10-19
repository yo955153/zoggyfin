import type { BaseItemDto } from '@/api/types';

/** What a screen asks the player for. Phase 2 (video) and 3 (audio) implement it. */
export interface PlayRequest {
  item: BaseItemDto;
  /** Items to queue after `item` (album tracks, next episodes). */
  queue?: BaseItemDto[];
  startPositionTicks?: number;
}

export interface PlayerController {
  /** False until a player engine ships. */
  readonly available: boolean;
  play(request: PlayRequest): void;
}
