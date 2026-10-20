/**
 * The nearby "Watch together" wire protocol. Every message is one JSON object
 * with a version field `v`. A receiver drops a message with an unknown
 * version or a bad shape; it never throws.
 *
 * Times are milliseconds on the sender's monotonic clock unless the field
 * name says "host": the host is the clock of the session.
 * Positions are seconds in the media.
 */

export const PROTOCOL_VERSION = 1;
// Version 1 also covers the fields and messages that came with audio queues,
// reconnects and the host election: they are optional, and an older receiver
// ignores them. The transport changed from Multipeer to TCP (link.ts), so a
// build with Multipeer does not see a build with TCP at all.

export type MediaKind = 'video' | 'audio';

/** The slim item facts a guest needs to show and match the item. */
export interface SharedItem {
  id: string;
  /** The Jellyfin server of the host's download, when known. */
  serverId?: string | null;
  name: string;
  type: string;
  seriesName?: string | null;
  runTimeTicks?: number | null;
  mediaSourceId?: string | null;
  /** File extension of the host's file ("mp4"), for the stream URL. */
  container?: string | null;
  /** Audio: the album and the artists line. */
  album?: string | null;
  artist?: string | null;
  /** The URL path of the host's file on the session port ("/<token>/3.m4a"), or null when the host has no file. */
  path?: string | null;
  /** The URL path of the cover image on the session port, or null. */
  art?: string | null;
}

/** One entry of a shared audio queue. `key` is the host's queue entry key. */
export interface SharedEntry {
  key: string;
  item: SharedItem;
}

/** The host's audio queue: the order, the current entry and the play modes. */
export interface SharedQueue {
  entries: SharedEntry[];
  index: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  /** Long-form audio (audiobooks, recitations): speed and skip controls. */
  longForm: boolean;
}

/** At most this many queue entries go to the guests (around the current entry). */
export const MAX_SHARED_ENTRIES = 300;

/**
 * The playback state of the group. The expected position at host time T is
 * `position + (playing ? (T - hostTime) / 1000 * rate : 0)`.
 */
export interface Anchor {
  playing: boolean;
  rate: number;
  /** Host monotonic time of the anchor, ms. */
  hostTime: number;
  /** Media position at `hostTime`, seconds. */
  position: number;
}

/** Where a guest reads the host's file: a Bonjour service and a URL path on it. */
export interface StreamRef {
  service: string;
  path: string;
}

export interface Member {
  id: string;
  name: string;
  /** The member plays its own downloaded copy (else it streams from the host). */
  local: boolean;
  buffering: boolean;
  /** Host clock (ms) of the first join, for the host election (earliest first). */
  joinedAt?: number;
  /** The member has all the media of the session (its own downloads): it can become the host. */
  canHost?: boolean;
  /** The link to the member is lost; it can come back with the session key. */
  away?: boolean;
  /** The member can make a Wi-Fi network (an Android local-only hotspot). */
  maker?: boolean;
}

export type ControlAction =
  | { action: 'play'; position?: number }
  | { action: 'pause'; position?: number }
  | { action: 'seek'; position: number }
  | { action: 'rate'; rate: number }
  // Audio queues only.
  | { action: 'next' }
  | { action: 'previous' }
  | { action: 'jump'; key: string }
  | { action: 'shuffle'; on: boolean }
  | { action: 'repeat'; mode: 'off' | 'all' | 'one' };

export type Message =
  /** Guest to host, right after the link opens. */
  | {
      t: 'hello';
      name: string;
      have: string[];
      /** A stable id of the guest for this session (it keeps it when it reconnects). */
      memberId?: string;
      /** The guest has all the media of the session. */
      canHost?: boolean;
      /** The guest can make a Wi-Fi network (Android). */
      maker?: boolean;
    }
  /** Host to a guest that joined. */
  | {
      t: 'welcome';
      sessionId: string;
      item: SharedItem;
      /** The host's media stream, or null when no stream is offered. */
      stream: StreamRef | null;
      onlyHostControls: boolean;
      anchor: Anchor;
      /** The guest's member id, so it can leave itself out of the members list. */
      you?: string;
      kind?: MediaKind;
      /** Audio: the shared queue. The anchor applies to `track`. */
      queue?: SharedQueue;
      track?: string;
      /** The session key: a member that reconnects, or that joins a new host, sends it. */
      key?: string;
      /** Grows by one each time a new host takes over the session. */
      epoch?: number;
      /** The host's member id (stable across reconnects). */
      hostId?: string;
    }
  /** Clock sync: the guest sends t0 (its clock); the host answers with t1 (receive) and t2 (send), host clock. */
  | { t: 'ping'; id: number; t0: number }
  | { t: 'pong'; id: number; t0: number; t1: number; t2: number }
  /** Host to all: the new group state. `seq` grows with each change. */
  | { t: 'state'; seq: number; anchor: Anchor; waiting: boolean; /** Audio: the queue entry key that the anchor applies to. */ track?: string }
  /** Host to all (audio): the queue changed. */
  | { t: 'queue'; seq: number; queue: SharedQueue }
  /** Guest to host: a control request. */
  | ({ t: 'control' } & ControlAction)
  /** Guest to host: the guest buffers (true) or is ready (false). */
  | { t: 'buffering'; buffering: boolean; local: boolean; /** The guest has all the media now (audio: known after the welcome). */ canHost?: boolean }
  /** Host to all. */
  | { t: 'members'; members: Member[]; onlyHostControls: boolean }
  /** Host to a guest: you may not control playback. */
  | { t: 'denied'; reason: string }
  /** Host to all: the session is over. Guest to host: I leave. */
  | { t: 'end' }
  | { t: 'leave' };

export type MessageType = Message['t'];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const str = (x: unknown): x is string => typeof x === 'string';
const bool = (x: unknown): x is boolean => typeof x === 'boolean';
const optNum = (x: unknown) => x === undefined || num(x);

function isAnchor(x: unknown): x is Anchor {
  return isObj(x) && bool(x.playing) && num(x.rate) && x.rate > 0 && num(x.hostTime) && num(x.position);
}

function isItem(x: unknown): x is SharedItem {
  return isObj(x) && str(x.id) && x.id.length > 0 && str(x.name) && str(x.type);
}

const optStr = (x: unknown) => x === undefined || x === null || str(x);
const optBool = (x: unknown) => x === undefined || bool(x);
const isRepeat = (x: unknown): x is 'off' | 'all' | 'one' => x === 'off' || x === 'all' || x === 'one';

function isMember(x: unknown): x is Member {
  return isObj(x) && str(x.id) && str(x.name) && bool(x.local) && bool(x.buffering) && optNum(x.joinedAt) && optBool(x.canHost) && optBool(x.away) && optBool(x.maker);
}

function isFullItem(x: unknown): x is SharedItem {
  return isItem(x) && optStr(x.path) && optStr(x.art) && optStr(x.album) && optStr(x.artist);
}

export function isQueue(x: unknown): x is SharedQueue {
  if (!isObj(x) || !Array.isArray(x.entries) || x.entries.length > MAX_SHARED_ENTRIES || !num(x.index)) return false;
  if (!bool(x.shuffle) || !isRepeat(x.repeat) || !bool(x.longForm)) return false;
  if (!x.entries.every((e) => isObj(e) && str(e.key) && e.key.length > 0 && isFullItem(e.item))) return false;
  return x.entries.length === 0 ? x.index === -1 || x.index === 0 : x.index >= 0 && x.index < x.entries.length;
}

/** True when `x` has the shape of the message type it names. */
function valid(x: Record<string, unknown>): boolean {
  switch (x.t) {
    case 'hello':
      return str(x.name) && Array.isArray(x.have) && x.have.every(str) && optStr(x.memberId) && optBool(x.canHost) && optBool(x.maker);
    case 'welcome':
      return (
        str(x.sessionId) &&
        isItem(x.item) &&
        (x.stream === null || (isObj(x.stream) && str(x.stream.service) && str(x.stream.path))) &&
        bool(x.onlyHostControls) &&
        isAnchor(x.anchor) &&
        (x.you === undefined || str(x.you)) &&
        (x.kind === undefined || x.kind === 'video' || x.kind === 'audio') &&
        (x.queue === undefined || isQueue(x.queue)) &&
        optStr(x.track) &&
        optStr(x.key) &&
        optNum(x.epoch) &&
        optStr(x.hostId)
      );
    case 'ping':
      return num(x.id) && num(x.t0);
    case 'pong':
      return num(x.id) && num(x.t0) && num(x.t1) && num(x.t2);
    case 'state':
      return num(x.seq) && isAnchor(x.anchor) && bool(x.waiting) && optStr(x.track);
    case 'queue':
      return num(x.seq) && isQueue(x.queue);
    case 'control':
      switch (x.action) {
        case 'play':
        case 'pause':
          return optNum(x.position);
        case 'seek':
          return num(x.position) && x.position >= 0;
        case 'rate':
          return num(x.rate) && x.rate >= 0.25 && x.rate <= 4;
        case 'next':
        case 'previous':
          return true;
        case 'jump':
          return str(x.key) && x.key.length > 0;
        case 'shuffle':
          return bool(x.on);
        case 'repeat':
          return isRepeat(x.mode);
        default:
          return false;
      }
    case 'buffering':
      return bool(x.buffering) && bool(x.local) && optBool(x.canHost);
    case 'members':
      return Array.isArray(x.members) && x.members.every(isMember) && bool(x.onlyHostControls);
    case 'denied':
      return str(x.reason);
    case 'end':
    case 'leave':
      return true;
    default:
      return false;
  }
}

export function encode(message: Message): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}

/** The message, or null for text that is not a valid message of this version. */
export function decode(text: string): Message | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== PROTOCOL_VERSION || !str(raw.t)) return null;
  if (!valid(raw)) return null;
  const { v: _v, ...rest } = raw;
  return rest as unknown as Message;
}

/** The context a guest sends with its join request. */
export interface JoinContext {
  v: number;
  name: string;
  /** The guest has the item downloaded. */
  have: boolean;
  /**
   * The session key (a member that comes back, or that follows a new host) or
   * the key of a join code. A correct full key lets the guest in with no new
   * approval; a code key only tells the host that the guest has its code.
   */
  key?: string;
  memberId?: string;
}

export function encodeJoinContext(ctx: Omit<JoinContext, 'v'>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...ctx });
}

export function decodeJoinContext(text: string | null | undefined): JoinContext | null {
  if (!text) return null;
  try {
    const x: unknown = JSON.parse(text);
    if (isObj(x) && x.v === PROTOCOL_VERSION && str(x.name) && bool(x.have) && (x.key === undefined || str(x.key)) && (x.memberId === undefined || str(x.memberId))) {
      return { v: PROTOCOL_VERSION, name: x.name, have: x.have, ...(str(x.key) ? { key: x.key } : {}), ...(str(x.memberId) ? { memberId: x.memberId } : {}) };
    }
  } catch {
    // Not ours.
  }
  return null;
}

/**
 * The link handshake on a control socket (link.ts), before the session
 * messages: the guest sends `join`; the host answers `accept` or `decline`.
 */
export type LinkMessage = { t: 'join'; ctx: JoinContext } | { t: 'accept' } | { t: 'decline'; reason: string };

export function encodeLink(m: LinkMessage): string {
  if (m.t === 'join') {
    const { v: _v, ...ctx } = m.ctx;
    return JSON.stringify({ v: PROTOCOL_VERSION, l: 'join', ...ctx });
  }
  return JSON.stringify({ v: PROTOCOL_VERSION, l: m.t, ...(m.t === 'decline' ? { reason: m.reason } : {}) });
}

/** A link message, or null (then the text can be a session message). */
export function decodeLink(text: string): LinkMessage | null {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(x) || x.v !== PROTOCOL_VERSION || !str(x.l)) return null;
  switch (x.l) {
    case 'join': {
      const ctx = decodeJoinContext(text);
      return ctx ? { t: 'join', ctx } : null;
    }
    case 'accept':
      return { t: 'accept' };
    case 'decline':
      return { t: 'decline', reason: str(x.reason) ? x.reason : 'The host did not let you join.' };
    default:
      return null;
  }
}

/**
 * What the host advertises (Bonjour TXT record through Multipeer). Keys and
 * values stay short: the whole record must stay under about 400 bytes.
 */
export interface Advert {
  sessionId: string;
  hostName: string;
  itemId: string;
  itemName: string;
  /** The server of the shared download, or null. */
  serverId: string | null;
  kind?: MediaKind;
  /** The host election count (0 for the first host). */
  epoch?: number;
}

const MAX_ADVERT_VALUE = 60;

export function encodeAdvert(a: Advert): Record<string, string> {
  return {
    v: String(PROTOCOL_VERSION),
    s: a.sessionId.slice(0, 36),
    h: a.hostName.slice(0, MAX_ADVERT_VALUE),
    i: a.itemId.slice(0, 64),
    n: a.itemName.slice(0, MAX_ADVERT_VALUE),
    ...(a.serverId ? { sv: a.serverId.slice(0, 64) } : {}),
    ...(a.kind === 'audio' ? { k: 'a' } : {}),
    ...(a.epoch ? { e: String(a.epoch) } : {}),
  };
}

export function decodeAdvert(info: Record<string, string> | null | undefined): Advert | null {
  if (!info || info.v !== String(PROTOCOL_VERSION) || !info.s || !info.i) return null;
  const epoch = Number(info.e ?? '0');
  return {
    sessionId: info.s,
    hostName: info.h ?? 'Nearby device',
    itemId: info.i,
    itemName: info.n ?? '',
    serverId: info.sv ?? null,
    kind: info.k === 'a' ? 'audio' : 'video',
    epoch: Number.isInteger(epoch) && epoch >= 0 ? epoch : 0,
  };
}
