/**
 * TV overscan: many TVs (and Fire TV by default) crop the edges of the
 * picture, so a TV reports no safe-area insets but still hides about 5 % of
 * each edge. On TV this provider reports that 5 % (`tv.safeX`, `tv.safeY`)
 * as the safe-area insets, so every part that already keeps clear of the
 * insets (the player controls and overlays, toasts, sheets, Now Playing)
 * stays inside the visible picture with no TV code of its own. Screens with
 * no insets of their own use `useLayout().safe`. Elsewhere it passes the
 * real insets through.
 */
import { type ReactNode, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { isTV } from '@/platform/tv';

import { tvSafeInset } from './layout';

export function TvSafeArea({ children }: { children: ReactNode }) {
  if (!isTV) return <>{children}</>;
  return <TvInsets>{children}</TvInsets>;
}

function TvInsets({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const insets = useMemo(() => {
    const s = tvSafeInset(width);
    return { top: s.y, bottom: s.y, left: s.x, right: s.x };
  }, [width]);
  return <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>;
}
