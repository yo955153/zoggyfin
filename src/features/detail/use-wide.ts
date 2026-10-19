import { useWindowDimensions } from 'react-native';

/** Wide windows (iPad, Mac, desktop web) get two-column detail pages. Based on the window, never the device. */
export const WIDE_BREAKPOINT = 820;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}
