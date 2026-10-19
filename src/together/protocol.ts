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

/** The slim item facts a guest needs to show and match the item. */
export interface SharedItem {
  id: string;
  name: string;
  type: string;
  seriesName?: string | null;
  runTimeTicks?: number | null;
  mediaSourceId?: string | null;
  /** File extension of the host's file ("mp4"), for the stream URL. */
  container?: string | null;
}

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
}

export type ControlAction =
  | { action: 'play'; position?: number }
  | { action: 'pause'; position?: number }
  | { action: 'seek'; position: number }
  | { action: 'rate'; rate: number };

export type Message =
  /** Guest to host, right after the link opens. */
  | { t: 'hello'; name: string; have: string[] }
  /** Host to a guest that joined. */
  | {
      t: 'welcome';
      sessionId: string;
      item: SharedItem;
      /** The host's media stream, or null when no stream is offered. */
      stream: StreamRef | null;
      onlyHostControls: boolean;
      anchor: Anchor;
    }
  /** Clock sync: the guest sends t0 (its clock); the host answers with t1 (receive) and t2 (send), host clock. */
  | { t: 'ping'; id: number; t0: number }
  | { t: 'pong'; id: number; t0: number; t1: number; t2: number }
  /** Host to all: the new group state. `seq` grows with each change. */
  | { t: 'state'; seq: number; anchor: Anchor; waiting: boolean }
  /** Guest to host: a control request. */
  | ({ t: 'control' } & ControlAction)
  /** Guest to host: the guest buffers (true) or is ready (false). */
  | { t: 'buffering'; buffering: boolean; local: boolean }
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

function isMember(x: unknown): x is Member {
  return isObj(x) && str(x.id) && str(x.name) && bool(x.local) && bool(x.buffering);
}

/** True when `x` has the shape of the message type it names. */
function valid(x: Record<string, unknown>): boolean {
  switch (x.t) {
    case 'hello':
      return str(x.name) && Array.isArray(x.have) && x.have.every(str);
    case 'welcome':
      return (
        str(x.sessionId) &&
        isItem(x.item) &&
        (x.stream === null || (isObj(x.stream) && str(x.stream.service) && str(x.stream.path))) &&
        bool(x.onlyHostControls) &&
        isAnchor(x.anchor)
      );
    case 'ping':
      return num(x.id) && num(x.t0);
    case 'pong':
      return num(x.id) && num(x.t0) && num(x.t1) && num(x.t2);
    case 'state':
      return num(x.seq) && isAnchor(x.anchor) && bool(x.waiting);
    case 'control':
      switch (x.action) {
        case 'play':
        case 'pause':
          return optNum(x.position);
        case 'seek':
          return num(x.position) && x.position >= 0;
        case 'rate':
          return num(x.rate) && x.rate >= 0.25 && x.rate <= 4;
        default:
          return false;
      }
    case 'buffering':
      return bool(x.buffering) && bool(x.local);
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

/** The context a guest sends with its join request (Multipeer invitation). */
export interface JoinContext {
  v: number;
  name: string;
  /** The guest has the item downloaded. */
  have: boolean;
}

export function encodeJoinContext(ctx: Omit<JoinContext, 'v'>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...ctx });
}

export function decodeJoinContext(text: string | null | undefined): JoinContext | null {
  if (!text) return null;
  try {
    const x: unknown = JSON.parse(text);
    if (isObj(x) && x.v === PROTOCOL_VERSION && str(x.name) && bool(x.have)) return { v: PROTOCOL_VERSION, name: x.name, have: x.have };
  } catch {
    // Not ours.
  }
  return null;
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
}

const MAX_ADVERT_VALUE = 60;

export function encodeAdvert(a: Advert): Record<string, string> {
  return {
    v: String(PROTOCOL_VERSION),
    s: a.sessionId.slice(0, 36),
    h: a.hostName.slice(0, MAX_ADVERT_VALUE),
    i: a.itemId.slice(0, 64),
    n: a.itemName.slice(0, MAX_ADVERT_VALUE),
  };
}

export function decodeAdvert(info: Record<string, string> | null | undefined): Advert | null {
  if (!info || info.v !== String(PROTOCOL_VERSION) || !info.s || !info.i) return null;
  return { sessionId: info.s, hostName: info.h ?? 'Nearby device', itemId: info.i, itemName: info.n ?? '' };
}
