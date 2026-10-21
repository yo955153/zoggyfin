/**
 * The Together hub: one idea, the "session", over two transports. A
 * session runs nearby (same Wi-Fi or Bluetooth, no internet) or on a
 * Jellyfin server (SyncPlay, from anywhere). The user sees one list of
 * sessions to join and one "Start a session" flow; this module picks the
 * transport. Pure: no React, no native modules.
 */
import type { NearbyHost, SyncPlayGroupView, TogetherState } from './store';
import { groupCount } from './syncplay-logic';

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
      title: a.itemName || (a.itemId === 'room' ? 'Picking something to play' : a.kind === 'audio' ? 'Music' : 'A video'),
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
  /** A room with no item yet: the host picks later. */
  room?: boolean;
}

/** The "Who can join?" choices for a picked item (or an empty room), and the one to start with. */
export function whoCanJoin(i: WhoInput): { options: WhoOption[]; initial: Transport | null } {
  const server = i.serverName ?? 'your server';
  const options: WhoOption[] = [];
  if (i.nearbyOn) {
    options.push({
      id: 'nearby',
      title: 'People near you',
      detail: i.room
        ? `Same Wi-Fi or Bluetooth. Guests play their own download, ${server}, or a stream from you.`
        : i.downloaded
          ? 'Same Wi-Fi or Bluetooth. No internet needed.'
          : `Same Wi-Fi or Bluetooth. Each guest needs the download, or a sign-in to ${server}.`,
    });
  }
  if (i.signedIn && !i.offline && i.onServer) {
    options.push({ id: 'server', title: `Anyone on ${server}`, detail: `They join from anywhere and sign in to ${server}.` });
  }
  const has = (t: Transport) => options.some((o) => o.id === t);
  let initial: Transport | null = null;
  if (has('nearby') && (i.downloaded || i.offline || i.room || !has('server'))) initial = 'nearby';
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

/** The first part of a nearby name ("Sam · iPhone" → "Sam"). */
export function shortName(name: string | null | undefined): string {
  return (name ?? '').split(' · ')[0]!.trim() || 'the host';
}

function people(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/**
 * The room bar text while a session runs ("Together · Dune · 3 people",
 * "Together · 3 people · Pick something to play"), or null when no session
 * runs. The title is the room's item.
 */
export function roomLabel(st: Pick<TogetherState, 'mode' | 'role' | 'phase' | 'members' | 'requests' | 'item' | 'hostName' | 'waiting' | 'syncplay'>): string | null {
  const title = st.item ? st.item.album || st.item.name : null;
  if (st.syncplay.group) {
    // No count while it is not known: a wrong number for a moment is worse than none.
    const n = groupCount(st.syncplay.group);
    if (st.waiting && title) return `Together · ${title} · Waiting for everyone`;
    if (title) return n === null ? `Together · ${title}` : `Together · ${title} · ${people(n)}`;
    return n === null ? 'Together · Pick something to play' : `Together · ${people(n)} · Pick something to play`;
  }
  if (st.mode !== 'nearby') return null;
  switch (st.phase.name) {
    case 'hosting': {
      const n = st.members.length + 1;
      if (st.requests.length === 1) return `Together · ${shortName(st.requests[0]!.name)} wants to join`;
      if (st.requests.length > 1) return `Together · ${st.requests.length} want to join`;
      if (st.members.some((m) => m.away)) return 'Together · Reconnecting…';
      if (!title) return `Together · ${people(n)} · Pick something to play`;
      return st.waiting ? `Together · ${title} · Waiting for everyone` : `Together · ${title} · ${people(n)}`;
    }
    case 'requesting':
    case 'syncing':
      return 'Together · Connecting…';
    case 'joined': {
      const n = st.members.length + 2;
      if (!title) return `Together · Waiting for ${shortName(st.hostName)} to pick something`;
      return st.waiting ? `Together · ${title} · Waiting for everyone` : `Together · ${title} · ${people(n)}`;
    }
    case 'reconnecting':
      return st.phase.waitingForHost ? 'Together · Waiting for the host' : 'Together · Reconnecting…';
    case 'ended':
      return 'Together · Ended';
    default:
      return null;
  }
}

/** What an item page's Play button does in a session: play for everyone, or nothing (only the host picks). */
export function playForEveryone(st: Pick<TogetherState, 'mode' | 'role' | 'phase' | 'onlyHostControls' | 'syncplay'>): { label: string; locked: boolean } | null {
  if (st.syncplay.group) return { label: 'Play for everyone', locked: false };
  if (st.mode !== 'nearby') return null;
  if (st.role === 'host' && st.phase.name === 'hosting') return { label: 'Play for everyone', locked: false };
  if (st.role === 'guest' && (st.phase.name === 'joined' || st.phase.name === 'reconnecting')) {
    return st.onlyHostControls ? { label: 'Only the host picks', locked: true } : { label: 'Play for everyone', locked: false };
  }
  return null;
}

/**
 * The "who controls" row of the session sheet.
 * - `switch`: the nearby host turns "Only I control" on or off.
 * - `shown`: a nearby guest sees the host's choice.
 * - `server`: a server session (Jellyfin SyncPlay). Jellyfin has no host and
 *   lets every member play, pause and seek, so nobody can turn it off there.
 *   The sheet says so, and offers a nearby session instead.
 */
export type ControlSetting = { kind: 'switch'; onlyHost: boolean } | { kind: 'shown'; onlyHost: boolean } | { kind: 'server' } | null;

export function controlSetting(st: Pick<TogetherState, 'mode' | 'role' | 'onlyHostControls' | 'syncplay'>): ControlSetting {
  if (st.syncplay.group) return { kind: 'server' };
  if (st.mode !== 'nearby') return null;
  if (st.role === 'host') return { kind: 'switch', onlyHost: st.onlyHostControls };
  if (st.role === 'guest') return { kind: 'shown', onlyHost: st.onlyHostControls };
  return null;
}

/** The text of a server session's control row. */
export const SERVER_CONTROLS_TEXT =
  'Everyone can play, pause and seek. Server sessions (Jellyfin SyncPlay) have no host, so this cannot be changed. For “Only I control”, move to a nearby session.';
