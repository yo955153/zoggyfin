/**
 * "Search channels" from the player's channel list. The player stops the
 * stream, closes and leaves a request; the Live TV page takes it when it
 * gets the focus and opens its search. One request at a time.
 */
let pending = false;

export function requestChannelSearch(): void {
  pending = true;
}

/** True once (then cleared) when the search must open. */
export function takeChannelSearch(): boolean {
  const p = pending;
  pending = false;
  return p;
}

/** True while no Live TV page took the request yet. */
export function channelSearchPending(): boolean {
  return pending;
}
