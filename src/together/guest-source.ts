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

/**
 * Picks the guest's video source, in this order: its own download, the
 * host's file on the session port, a stream from the item's server when the
 * guest is signed in to that server (same server Id). A server stream is
 * never relayed through the host. Pure: the caller gives the facts.
 */
export function chooseGuestVideoSource(
  item: Pick<SharedItem, 'serverId' | 'path'>,
  facts: { ownFile: string | null; base: string | null; activeServerId: string | null; forceStream?: boolean },
): GuestVideoSource {
  if (facts.ownFile && !facts.forceStream) return { kind: 'local', uri: facts.ownFile };
  if (facts.base && item.path) return { kind: 'host', uri: `${facts.base}${item.path}` };
  if (item.serverId && facts.activeServerId && item.serverId === facts.activeServerId) return { kind: 'server' };
  return { kind: 'none', reason: item.serverId ? 'no-access' : 'no-file' };
}

/** The guest's line when it cannot play the host's video. */
export function noAccessText(hostName: string): string {
  return `${hostName} streams this from a server you are not signed in to. Ask them to download it first, or sign in to that server.`;
}
