/**
 * The play router. While a together session (a "room") runs, the normal
 * Play buttons go to the session first: a host plays the item here and the
 * room shares it, a guest asks the host, and a SyncPlay member sets the
 * group queue. With no session, every request plays here as before.
 *
 * Next episode and autoplay at the end of a video go through it too, so the
 * group decides what plays next.
 */
import type { PlayRequest } from './types';

/** `user`: a Play button. `next`: Next or autoplay at the end of a video. */
export type PlayOrigin = 'user' | 'next';

export interface PlayRoute {
  /** The request to play on this device, or null when the session took it. */
  route(request: PlayRequest, origin: PlayOrigin): PlayRequest | null;
  /** True when this device may start the next episode by itself at the end of a video. */
  autoplay(): boolean;
  /** A text when this device may not change its own queue (Play next, Add to queue, Instant Mix), else null. */
  queueLock(): string | null;
}

let current: PlayRoute | null = null;

export const playRouter = {
  get active(): boolean {
    return current !== null;
  },
  set(next: PlayRoute | null): void {
    current = next;
  },
  route(request: PlayRequest, origin: PlayOrigin): PlayRequest | null {
    return current ? current.route(request, origin) : request;
  },
  /** With no session: true. In a session: what the session says. */
  autoplay(): boolean {
    return current ? current.autoplay() : true;
  },
  queueLock(): string | null {
    return current ? current.queueLock() : null;
  },
};
