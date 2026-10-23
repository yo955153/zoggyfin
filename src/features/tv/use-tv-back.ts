import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

import { isTV } from '@/platform/tv';

/**
 * TV: the remote's Back key (Escape in the web preview) runs `onBack` while
 * `enabled`, instead of going back a page. Handlers added later run first.
 */
export function useTvBack(enabled: boolean, onBack: () => void): void {
  const handler = useRef(onBack);
  useEffect(() => {
    handler.current = onBack;
  });
  useEffect(() => {
    if (!isTV || !enabled) return;
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handler.current();
      };
      document.addEventListener('keydown', onKey, true);
      return () => document.removeEventListener('keydown', onKey, true);
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handler.current();
      return true;
    });
    return () => sub.remove();
  }, [enabled]);
}
