/**
 * The guest's video source in a nearby session. Pure, so it is easy to test.
 */
import type { SharedItem } from './protocol';

/** Where a guest plays the video of a nearby session. */
export type GuestVideoSource =
  | { kind: 'local'; uri: string }
  | { kind: 'host'; uri: string }
  /** The guest is signed in to the item's server: it streams from that server at the group position. */
  | { kind: 'server' }
  /** No copy, no host file and no sign-in to the item's server. */
  | { kind: 'none'; reason: 'no-access' | 'no-file' };

export interface GuestSourceFacts {
  /** The guest's own download of the item, or null. */
  ownFile: string | null;
  /** The URL base of the host's session port, or null. */
  base: string | null;
  /** The server that the guest is signed in to, or null. */
  activeServerId: string | null;
  /** The guest reaches that server now (false: offline, a plane, a hotspot with no internet). */
  serverReachable: boolean;
  /** Development (together lab): stream from the host even with a copy or a server. */
  forceStream?: boolean;
}

/**
 * Picks the guest's video source, in this order:
 * 1. its own download;
 * 2. the item's Jellyfin server, when the guest is signed in to that server
 *    (the same server Id) and reaches it. The media then does not use the
 *    host's upload, which is the limit of a nearby session;
 * 3. the host's file on the session port.
 * A server stream is never relayed through the host. Pure: the caller gives the facts.
 */
export function chooseGuestVideoSource(item: Pick<SharedItem, 'serverId' | 'path'>, facts: GuestSourceFacts): GuestVideoSource {
  const hostUri = facts.base && item.path ? `${facts.base}${item.path}` : null;
  if (facts.forceStream && hostUri) return { kind: 'host', uri: hostUri };
  if (facts.ownFile && !facts.forceStream) return { kind: 'local', uri: facts.ownFile };
  const sameServer = !!item.serverId && !!facts.activeServerId && item.serverId === facts.activeServerId;
  if (sameServer && facts.serverReachable) return { kind: 'server' };
  if (hostUri) return { kind: 'host', uri: hostUri };
  // The host streams from its server: a guest that is signed in there tries it even when the last check failed.
  if (sameServer) return { kind: 'server' };
  return { kind: 'none', reason: item.serverId ? 'no-access' : 'no-file' };
}

/** The guest's line when it cannot play the host's video. */
export function noAccessText(hostName: string): string {
  return `${hostName} streams this from a server you are not signed in to. Ask them to download it first, or sign in to that server.`;
}

/**
 * Where the guest's player plays from: its own download, its own server, or
 * the host's file (`stream`). Null: nothing plays.
 */
export type GuestPlaySource = 'local' | 'server' | 'stream' | null;

/**
 * True when the guest keeps its player after the session (the host ended it,
 * the link was lost, or the guest left): it plays its own download, or it
 * streams from its own server while signed in. It then plays on alone, and
 * the server has its position. The host's file is gone with the host, and a
 * guest with no account has no player outside the session: those close.
 */
export function guestKeepsPlayer(source: GuestPlaySource, signedIn: boolean): boolean {
  return signedIn && (source === 'local' || source === 'server');
}
