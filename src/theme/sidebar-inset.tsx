import { createContext, type ReactNode, useContext } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Width that a visible iPad sidebar takes from the leading edge of a tab's
 * content (0 elsewhere). The iPadOS 26 sidebar floats over the tab content,
 * and UIKit reports it as a leading safe-area inset inside the tab. iPads
 * have no side insets of their own, so that inset is the sidebar.
 */
const SidebarInsetContext = createContext(0);

export function useSidebarInset(): number {
  return useContext(SidebarInsetContext);
}

function PadInset({ children }: { children: (inset: number) => ReactNode }) {
  const inset = Math.max(0, Math.round(useSafeAreaInsets().left));
  return <SidebarInsetContext.Provider value={inset}>{children(inset)}</SidebarInsetContext.Provider>;
}

/** Wraps a tab stack; `children` gets the sidebar inset for its screen options. */
export function SidebarInsetProvider({ children }: { children: (inset: number) => ReactNode }) {
  if (Platform.OS !== 'ios' || !Platform.isPad) return <>{children(0)}</>;
  return <PadInset>{children}</PadInset>;
}
