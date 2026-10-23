import { useCallback, useEffect, useRef } from 'react';
import { type TVRemoteEvent, useTVEventHandler } from 'react-native';

import { isNativeTV } from '@/platform/tv';

/**
 * TV: every remote key press (D-pad, select, media keys), whatever has the
 * focus. react-native-tvos sends them from the root view, so a native view
 * that holds the focus (the video) cannot hide them. A no-op off TV.
 */
export function useTvRemote(enabled: boolean, onEvent: (e: TVRemoteEvent) => void): void {
  const handler = useRef(onEvent);
  const on = useRef(enabled);
  useEffect(() => {
    handler.current = onEvent;
    on.current = enabled;
  });
  const listener = useCallback((e: TVRemoteEvent) => {
    if (on.current) handler.current(e);
  }, []);
  // isNativeTV never changes while the app runs, so the hook order is stable.
  if (isNativeTV && typeof useTVEventHandler === 'function') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useTVEventHandler(listener);
  }
}
