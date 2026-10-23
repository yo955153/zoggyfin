/**
 * TV focus helpers. The side menu needs to send the focus back to the
 * content it came from (Back or Right), and some views must keep the focus
 * inside them (the player). Web and phones get plain views.
 */
import type { ComponentRef, Ref } from 'react';
import { TVFocusGuideView, View, type ViewProps } from 'react-native';

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

type GuideOwnProps = 'destinations' | 'autoFocus' | 'safePadding' | 'trapFocusUp' | 'trapFocusDown' | 'trapFocusLeft' | 'trapFocusRight' | 'onFocusEnter' | 'onFocusLeave';

export interface TvFocusGuideProps extends Omit<ViewProps, GuideOwnProps> {
  ref?: Ref<FocusTarget>;
  /** Remember the last focused child and give the focus back to it when the focus comes in again. */
  autoFocus?: boolean;
  /** Where the focus goes when it comes into this view. */
  destinations?: (FocusTarget | null)[];
  /** Keep the focus inside this view in every direction. */
  trapFocus?: boolean;
  onFocusEnter?: () => void;
  onFocusLeave?: () => void;
}

/**
 * A react-native-tvos focus guide on a real TV; a plain view elsewhere (the
 * web build has no focus guides). It has no `focusable` prop on purpose: on
 * Android TV `focusable` makes the guide itself a focus target, and taking
 * the prop away again blocks every child. Unmount what must not take focus.
 */
export function TvFocusGuide({ autoFocus, destinations, trapFocus, onFocusEnter, onFocusLeave, ...rest }: TvFocusGuideProps) {
  if (!isNativeTV || !TVFocusGuideView) return <View {...rest} />;
  const dests = destinations?.filter((d): d is FocusTarget => !!d);
  return (
    <TVFocusGuideView
      {...rest}
      autoFocus={autoFocus}
      destinations={dests && dests.length ? dests : undefined}
      trapFocusUp={trapFocus}
      trapFocusDown={trapFocus}
      trapFocusLeft={trapFocus}
      trapFocusRight={trapFocus}
      onFocusEnter={onFocusEnter}
      onFocusLeave={onFocusLeave}
    />
  );
}
