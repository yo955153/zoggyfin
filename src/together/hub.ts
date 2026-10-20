/**
 * The Together hub: one idea, the "session", over two transports. A
 * session runs nearby (same Wi-Fi or Bluetooth, no internet) or on a
 * Jellyfin server (SyncPlay, from anywhere). The user sees one list of
 * sessions to join and one "Start a session" flow; this module picks the
 * transport. Pure: no React, no native modules.
 */
import type { NearbyHost, SyncPlayGroupView, TogetherState } from './store';

export type Transport = 'nearby' | 'server';

/** One row of "Sessions you can join". */
export interface SessionRow {
  key: string;
  hostName: string;
  /** What plays: the item, or the group's state and people. */
  title: string;
  /** "Nearby" or "On <server name>". */
  tag: string;
  kind: 'video' | 'audio' | null;
  /** The nearby host, when one is in range. Join prefers it. */
  peerId: string | null;
  /** The server group, when there is one. */
  groupId: string | null;
  /** Found over Bluetooth only: a join first makes a Wi-Fi link. */
  ble: boolean;
}

export interface ServerContext {
  serverId: string | null;
  serverName: string | null;
}

/** The user part of a nearby host name ("Sam · iPhone" → "sam"). */
function advertUser(hostName: string): string {
  return hostName.split(' · ')[0]!.trim().toLowerCase();
}

/** The owner of a group that this app made ("Sam's group" → "sam"), else null. */
function groupOwner(name: string): string | null {
  const m = /^(.+?)['’]s group$/i.exec(name.trim());
  return m ? m[1]!.trim().toLowerCase() : null;
}

/** The plain "<state> · <people>" line of a server group. */
function groupTitle(g: SyncPlayGroupView, stateLabel: (s: string) => string): string {
  return [stateLabel(g.state), g.participants.join(', ')].filter(Boolean).join(' · ');
}

/**
 * One list of the sessions this device can join: the nearby hosts and the
 * groups on the signed-in server. A nearby host and a group that are the
 * same session (same owner, same server) make one row, tagged "Nearby",
 * because a nearby join syncs better and can use downloads.
 */
export function mergeSessions(
  hosts: readonly NearbyHost[],
  groups: readonly SyncPlayGroupView[],
  server: ServerContext,
  stateLabel: (s: string) => string = (s) => s,
): SessionRow[] {
  const rows: SessionRow[] = [];
  const used = new Set<string>();
  for (const h of hosts) {
    const a = h.advert;
    const twin = groups.find((g) => !used.has(g.id) && !!server.serverId && a.serverId === server.serverId && groupOwner(g.name) === advertUser(a.hostName));
    if (twin) used.add(twin.id);
    rows.push({
      key: `n:${h.peerId}`,
      hostName: a.hostName,
      title: a.itemName || (a.kind === 'audio' ? 'Music' : 'A video'),
      tag: 'Nearby',
      kind: a.kind ?? 'video',
      peerId: h.peerId,
      groupId: twin?.id ?? null,
      ble: h.via === 'ble',
    });
  }
  for (const g of groups) {
    if (used.has(g.id)) continue;
    rows.push({
      key: `g:${g.id}`,
      hostName: g.name,
      title: groupTitle(g, stateLabel),
      tag: `On ${server.serverName ?? 'your server'}`,
      kind: null,
      peerId: null,
      groupId: g.id,
      ble: false,
    });
  }
  return rows;
}

/** How a join goes: nearby when the host is in range, else through the server. */
export function joinTransport(row: Pick<SessionRow, 'peerId' | 'groupId'>): Transport | null {
  if (row.peerId) return 'nearby';
  if (row.groupId) return 'server';
  return null;
}

export interface WhoOption {
  id: Transport;
  title: string;
  detail: string;
}

export interface WhoInput {
  /** This app can run a nearby session (not the browser, not TV). */
  nearbyOn: boolean;
  signedIn: boolean;
  offline: boolean;
  serverName: string | null;
  /** The picked item is on the signed-in server. */
  onServer: boolean;
  /** The host has the item (or every queue entry) downloaded. */
  downloaded: boolean;
}

/** The "Who can join?" choices for a picked item, and the one to start with. */
export function whoCanJoin(i: WhoInput): { options: WhoOption[]; initial: Transport | null } {
  const server = i.serverName ?? 'your server';
  const options: WhoOption[] = [];
  if (i.nearbyOn) {
    options.push({
      id: 'nearby',
      title: 'People near you',
      detail: i.downloaded
        ? 'Same Wi-Fi or Bluetooth. No internet needed.'
        : `Same Wi-Fi or Bluetooth. Each guest needs the download, or a sign-in to ${server}.`,
    });
  }
  if (i.signedIn && !i.offline && i.onServer) {
    options.push({ id: 'server', title: `Anyone on ${server}`, detail: `They join from anywhere and sign in to ${server}.` });
  }
  const has = (t: Transport) => options.some((o) => o.id === t);
  let initial: Transport | null = null;
  if (has('nearby') && (i.downloaded || i.offline || !has('server'))) initial = 'nearby';
  else if (has('server')) initial = 'server';
  return { options, initial };
}

/** The plain line at the top of a running session: where it runs and who is in it. */
export function sessionHeadline(st: Pick<TogetherState, 'mode' | 'role' | 'members' | 'syncplay'>, serverName: string | null): string | null {
  if (st.syncplay.group) return `On ${serverName ?? 'your server'} · from anywhere`;
  if (st.mode !== 'nearby' || !st.role) return null;
  // The host is not in its own member list; a guest's list has every other guest.
  const n = st.members.length + (st.role === 'host' ? 1 : 2);
  return `Nearby · ${n} ${n === 1 ? 'person' : 'people'}`;
}
