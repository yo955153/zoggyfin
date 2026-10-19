/**
 * Which local download matches a shared item. Nearby mode works with the
 * downloads of every saved server, whatever account is active, and with
 * no server connection.
 *
 * A download matches when it is complete, has the same item Id and comes
 * from the same server. When either side does not know its server Id, the
 * item Id alone decides (Jellyfin item Ids are random GUIDs, so two servers
 * practically never share one).
 */
export interface MatchableDownload {
  itemId: string;
  serverId?: string | null;
  state: string;
}

export interface MatchTarget {
  id: string;
  serverId?: string | null;
}

export function matchesShared(record: MatchableDownload | null | undefined, target: MatchTarget): boolean {
  if (!record || record.state !== 'completed' || record.itemId !== target.id) return false;
  if (!record.serverId || !target.serverId) return true;
  return record.serverId === target.serverId;
}
