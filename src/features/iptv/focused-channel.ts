/**
 * TV: the channel that has the focus in the Live TV list, for the details
 * panel beside it. It is its own small store, not state of the Live TV page:
 * a focus move then re-renders only the panel, not the page and its list.
 * The panel follows after the focus stops for a moment (`SETTLE_MS`), so a
 * held D-pad on a slow TV stick does not render the panel for every row.
 */
import { create } from 'zustand';

import type { ProviderChannel } from '@/iptv';

/** How long the focus must stay on a row before the panel shows it. */
export const SETTLE_MS = 120;

const useFocusedStore = create<{ view: string | null; row: ProviderChannel | null }>(() => ({ view: null, row: null }));

let timer: ReturnType<typeof setTimeout> | null = null;

/** Notes the focused row of a list view (a provider id or "All providers"). */
export function focusChannel(view: string | null, row: ProviderChannel): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    useFocusedStore.setState({ view, row });
  }, SETTLE_MS);
}

/** The focused row of this list view, or null. */
export function useFocusedChannel(view: string | null): ProviderChannel | null {
  return useFocusedStore((s) => (s.view === view ? s.row : null));
}
