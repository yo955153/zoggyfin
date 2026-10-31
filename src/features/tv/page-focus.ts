/**
 * TV focus rules for the pages of the tab stacks. Pure, so it is unit-tested.
 *
 * Only one page is visible at a time: the focused screen of the open tab.
 * Android TV keeps the page under it (and the page that is closing) in the
 * window while a transition runs, and a focus guide that remembers a control
 * there gives the focus back to it. The focus then sits on a page that
 * nobody sees, and the remote seems to do nothing. The registry knows the
 * visible page, so the focus goes there and nowhere else.
 */
import type { TvKey } from '@/player/tv-keys';

export interface PageRegistry<P> {
  /** The visible page, or null (no tab page is visible, for example under the player). */
  active: () => P | null;
  /** A page became the visible page (its navigation `focus` event). */
  focus: (page: P) => void;
  /** A page stopped being the visible page (`blur`, or it unmounted). */
  blur: (page: P) => void;
  /** True when a control of `page` must not keep the focus: another page is the visible one. */
  isHidden: (page: P | null) => boolean;
  /** Runs `fn` when the visible page changes. Returns the unsubscribe function. */
  subscribe: (fn: () => void) => () => void;
}

/**
 * The visible page. Navigation sends `blur` to the old page and `focus` to the
 * new one in either order, so `blur` clears only the page it names.
 */
export function createPageRegistry<P>(): PageRegistry<P> {
  let current: P | null = null;
  const listeners = new Set<() => void>();
  const set = (next: P | null) => {
    if (next === current) return;
    current = next;
    for (const fn of [...listeners]) fn();
  };
  return {
    active: () => current,
    focus: (page) => set(page),
    blur: (page) => {
      if (current === page) set(null);
    },
    isHidden: (page) => page !== null && current !== null && page !== current,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The last remote key and when it came (ms). */
export interface KeyMemory {
  key: TvKey | null;
  at: number;
}

export const NO_KEY: KeyMemory = { key: null, at: 0 };

/** A direction key this recent means the person moved the focus into the side menu (ms). */
export const MENU_KEY_MS = 1500;

/**
 * Whether a page that opened or came back may take the focus. It may, except
 * when the person has just moved into the side menu with the D-pad. Android
 * also puts the focus into the menu by itself when the focused control
 * leaves the window (Back from Settings): no direction key comes with that,
 * so the page takes the focus back.
 */
export function pageMayTakeFocus(menuFocused: boolean, last: KeyMemory, now: number, windowMs: number = MENU_KEY_MS): boolean {
  if (!menuFocused) return true;
  const direction = last.key === 'left' || last.key === 'up' || last.key === 'down';
  const age = now - last.at;
  return !(direction && age >= 0 && age <= windowMs);
}

/** Why a page asks for the focus. */
export type ClaimReason =
  /** The page is visible again: Back, its tab opened again, the player closed. */
  | 'return'
  /** The page opened, or one of its transitions ended. */
  | 'open'
  /** A control of the page mounted (its content loaded). */
  | 'controlMounted';

export interface ClaimState {
  reason: ClaimReason;
  /** A control of this page has the focus. */
  focusOnPage: boolean;
  /** A control of a page that is not visible has the focus. */
  focusOnHiddenPage: boolean;
  /** No control has the focus: not a page, not the side menu, not a text field (Android dropped it). */
  focusNowhere: boolean;
  menuFocused: boolean;
  last: KeyMemory;
  now: number;
}

/**
 * Whether the visible page asks its focus guide for the focus now. The guide
 * gives it to the control the page had last, so a focus already on the page
 * stays where it is. A control that mounts late (content loaded) takes the
 * focus only from a page nobody sees or when nothing has it: never from the
 * page itself (its sheets live in another window), the search field or the
 * side menu.
 */
export function pageShouldTakeFocus(s: ClaimState): boolean {
  if (!pageMayTakeFocus(s.menuFocused, s.last, s.now)) return false;
  if (s.reason === 'controlMounted') return !s.focusOnPage && (s.focusOnHiddenPage || s.focusNowhere);
  return true;
}
