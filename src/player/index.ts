/**
 * The app-level player interface. Screens call `usePlayer().play(...)` and
 * never talk to an engine. Phase 1 has no engine: play shows a notice.
 * Phase 2 adds the expo-video engine behind this file, phase 3 expo-audio.
 */
import { toast } from '@/lib/toast';

import type { PlayerController } from './types';

export type { PlayerController, PlayRequest } from './types';

const stubPlayer: PlayerController = {
  available: false,
  play: () => toast('Playback is coming soon.'),
};

export function usePlayer(): PlayerController {
  return stubPlayer;
}
