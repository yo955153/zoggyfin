import { Platform } from 'react-native';

import { KeyInput } from '@/native/key-input';
import type { KeyPress } from '@/native/key-input-types';
import { activePlayback } from '@/player';
import { audioState } from '@/player/audio/store';
import { usePlayerStore } from '@/player/store';

const hidden = { position: 'absolute', width: 0, height: 0 } as const;

/**
 * Web: Space plays or pauses and ←/→ seek while something plays and no full
 * player is open (the full players have their own keys). Shift+←/→ skip
 * tracks. Text fields keep their keys.
 */
export function GlobalPlayerKeys() {
  const active = usePlayerStore((s) => !!s.now && s.presentation !== 'full');
  if (Platform.OS !== 'web' || !active) return null;
  const onKey = (k: KeyPress) => {
    const long = audioState().longForm;
    switch (k.key) {
      case ' ':
      case 'k':
        activePlayback.togglePlay();
        break;
      case 'ArrowLeft':
        if (k.shift) activePlayback.previous();
        else activePlayback.skip(long ? -15 : -10);
        break;
      case 'ArrowRight':
        if (k.shift) activePlayback.next();
        else activePlayback.skip(long ? 30 : 10);
        break;
    }
  };
  return <KeyInput onKey={onKey} style={hidden} />;
}
