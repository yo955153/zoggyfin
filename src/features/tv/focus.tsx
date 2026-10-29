/**
 * TV focus helpers. The side menu needs to send the focus back to the
 * content it came from (Back or Right), and some views must keep the focus
 * inside them (the player). Web and phones get plain views.
 */
import type { ComponentRef, Ref } from 'react';
import { Platform, TVFocusGuideView, View, type ViewProps } from 'react-native';

import { isNativeTV, isTV } from '@/platform/tv';

/** A host view. react-native-tvos adds `requestTVFocus`; on web it is a DOM element with `focus`. */
export type FocusTarget = ComponentRef<typeof View>;

type FocusMethods = { requestTVFocus?: () => void; focus?: () => void };

let lastContent: FocusTarget | null = null;

/** A control in the content (not the side menu) took the focus. */
export function rememberContentFocus(view: FocusTarget | null): void {
  if (isTV && view) lastContent = view;
}

/** A remembered control went away. */
export function forgetContentFocus(view: FocusTarget | null): void {
  if (view && lastContent === view) lastContent = null;
}

/** Moves the focus to a view. False when the view cannot take it. */
export function focusView(view: FocusTarget | null | undefined): boolean {
  const v = view as (FocusTarget & FocusMethods) | null | undefined;
  if (!v) return false;
  try {
    if (typeof v.requestTVFocus === 'function') {
      v.requestTVFocus();
      return true;
    }
    if (typeof v.focus === 'function') {
      v.focus();
      return true;
    }
  } catch {
    // The view was unmounted.
  }
  return false;
}

/** Sends the focus back to the last focused control in the content. */
export function restoreContentFocus(): boolean {
  return focusView(lastContent);
}

let contentGuide: FocusTarget | null = null;
let menuFocused = false;

/** The focus guide around the tab content (the side menu layout owns it). */
export function setContentGuide(view: FocusTarget | null): void {
  contentGuide = view;
}

/** An item of the side menu took or lost the focus. */
export function setMenuFocused(focused: boolean): void {
  menuFocused = focused;
}

/** The pause after a page transition ends, so the page it covered has left the window. */
const SETTLE_MS = 60;

/**
 * Android TV, after a page opens or closes in a tab stack. The page that was
 * covered or closed leaves the window only when its transition ends; if it
 * had the focus, Android drops the focus and the remote moves nothing. A
 * page without a preferred focus (Settings) was never reachable. Asking
 * the content guide for the focus again keeps a focus that is still there
 * and otherwise moves it to the first control of the visible page. The side
 * menu keeps a focus it has.
 */
function refocusContent(): void {
  setTimeout(() => {
    if (!menuFocused) focusView(contentGuide);
  }, SETTLE_MS);
}

/** `screenListeners` for the tab stacks. */
export const tvStackListeners = isNativeTV && Platform.OS === 'android' ? { transitionEnd: refocusContent } : undefined;

type GuideOwnProps = 'destinations' | 'autoFocus' | 'safePadding' | 'trapFocusUp' | 'trapFocusDown' | 'trapFocusLeft' | 'trapFocusRight' | 'onFocusEnter' | 'onFocusLeave';

export interface TvFocusGuideProps extends Omit<ViewProps, GuideOwnProps> {
  ref?: Ref<FocusTarget>;
  /** Remember the last focused child and give the focus back to it when the focus comes in again. */
  autoFocus?: boolean;
  /** Where the focus goes when it comes into this view. */
  destinations?: (FocusTarget | null)[];
  /** Keep the focus inside this view in every direction. */
  trapFocus?: boolean;
  /** Keep the focus inside this view for Left and Right only. */
  trapHorizontal?: boolean;
  onFocusEnter?: () => void;
  onFocusLeave?: () => void;
}

/**
 * A react-native-tvos focus guide on a real TV; a plain view elsewhere (the
 * web build has no focus guides). It has no `focusable` prop on purpose: on
 * Android TV `focusable` makes the guide itself a focus target, and taking
 * the prop away again blocks every child. Unmount what must not take focus.
 */
export function TvFocusGuide({ autoFocus, destinations, trapFocus, trapHorizontal, onFocusEnter, onFocusLeave, ...rest }: TvFocusGuideProps) {
  if (!isNativeTV || !TVFocusGuideView) return <View {...rest} />;
  const dests = destinations?.filter((d): d is FocusTarget => !!d);
  return (
    <TVFocusGuideView
      {...rest}
      autoFocus={autoFocus}
      destinations={dests && dests.length ? dests : undefined}
      trapFocusUp={trapFocus}
      trapFocusDown={trapFocus}
      trapFocusLeft={trapFocus || trapHorizontal}
      trapFocusRight={trapFocus || trapHorizontal}
      onFocusEnter={onFocusEnter}
      onFocusLeave={onFocusLeave}
    />
  );
}
