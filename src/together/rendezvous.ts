/**
 * The Bluetooth LE rendezvous. Two nearby devices with no shared Wi-Fi use
 * it to make one: the Android device makes a local-only hotspot and the other
 * device joins it. After that, the session runs over TCP (link-native-types.ts).
 *
 * The host H is the BLE peripheral. Its INFO characteristic (`encodeInfo`)
 * tells the guest G about the session. Then the messages go over RX / TX:
 *
 * 1. G -> H `hello` (plain), H -> G `hello` (plain). Each has an X25519
 *    public key. Both sides derive the same key (rendezvous-crypto.ts).
 * 2. G -> H `join` (sealed). The host person lets the guest in, or not.
 * 3. H -> G `accept` (sealed: the rejoin key and the maker) or `decline` (plain).
 * 4. The maker makes the Wi-Fi and sends `wifi` (sealed: SSID and password).
 *    The other side joins it.
 * 5. H -> G `addr` (sealed: the host's IPv4 addresses and the TCP port).
 * 6. G connects over TCP. `error` (plain) stops the rendezvous on both sides.
 *
 * The state machine below is pure: the caller gives it events and does the
 * effects that it returns (BLE send, hotspot, Wi-Fi join, timer, UI copy).
 * It ignores messages that are bad, repeated or out of order. It never throws.
 */
import { deriveKey, isPublicKey, type KeyPair, open, type Random, seal, utf8CodePointBytes, utf8Length } from './rendezvous-crypto';

export const RENDEZVOUS_VERSION = 1;
/** The largest BLE message (UTF-8 bytes). */
export const MAX_MESSAGE_BYTES = 4096;
/** The largest INFO text (UTF-8 bytes). */
export const MAX_INFO_BYTES = 200;

/** The deadline of each waiting state, ms. */
export const TIMERS = {
  /** A `hello`, `join` or `addr` from the peer (no human or radio work on the other side). */
  answer: 15_000,
  /** The host person lets the guest in. */
  approval: 120_000,
  /** The hotspot starts, or the Wi-Fi join completes. */
  wifi: 45_000,
  /** The TCP connect. */
  connect: 20_000,
} as const;

export type Platform = 'apple' | 'android';

/** What a device can do for the Wi-Fi link. */
export interface Caps {
  platform: Platform;
  /** The device can make a local-only hotspot (Android 8+). */
  canHotspot: boolean;
  /** The device can join a Wi-Fi network from the app. */
  canJoinWifi: boolean;
}

// ---------------------------------------------------------------------------
// Validation helpers

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const str = (x: unknown): x is string => typeof x === 'string';
const bool = (x: unknown): x is boolean => typeof x === 'boolean';
const isPlatform = (x: unknown): x is Platform => x === 'apple' || x === 'android';
const isSession = (x: unknown): x is string => str(x) && /^[0-9a-f]{8}$/.test(x);
const isRejoinKey = (x: unknown): x is string => str(x) && /^[0-9a-f]{20}$/.test(x);
const isName = (x: unknown): x is string => str(x) && x.length <= 100;
const isBox = (x: unknown): x is string => str(x) && x.length > 0 && x.length <= MAX_MESSAGE_BYTES;
const isPort = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 65535;

export function isIPv4(x: unknown): x is string {
  if (!str(x)) return false;
  const parts = x.split('.');
  return parts.length === 4 && parts.every((p) => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255);
}

function parseJson(text: unknown, maxBytes: number): unknown {
  if (!str(text) || text.length > maxBytes || utf8Length(text) > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BLE INFO

export interface BleInfo {
  v: 1;
  /** The session id, 8 hex. */
  session: string;
  /** The host's name. */
  host: string;
  /** The title of the item. */
  title: string;
  kind: 'video' | 'audio';
  platform: Platform;
  canHotspot: boolean;
  canJoinWifi: boolean;
}

/** The UTF-8 size of a string inside JSON (with its escapes, without the quotes). */
function jsonStringBytes(s: string): number {
  return utf8Length(JSON.stringify(s)) - 2;
}

/** The longest start of `s` (whole code points) whose JSON size is at most `max` bytes. */
function fitJsonString(s: string, max: number): string {
  if (jsonStringBytes(s) <= max) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    // A lone surrogate is escaped as \uXXXX (6 bytes); others use the normal JSON size.
    const size = cp >= 0xd800 && cp <= 0xdfff ? 6 : ch === '"' || ch === '\\' || cp < 0x20 ? jsonStringBytes(ch) : utf8CodePointBytes(cp);
    if (used + size > max) break;
    out += ch;
    used += size;
  }
  return out;
}

function infoJson(i: BleInfo, host: string, title: string): string {
  return JSON.stringify({
    v: RENDEZVOUS_VERSION,
    s: i.session,
    h: host,
    n: title,
    k: i.kind === 'audio' ? 'a' : 'v',
    p: i.platform === 'android' ? 'd' : 'a',
    c: (i.canHotspot ? 1 : 0) | (i.canJoinWifi ? 2 : 0),
  });
}

/**
 * The INFO text: JSON with short keys, at most 200 UTF-8 bytes. When it is
 * too long, the title becomes shorter first, then the host name. A cut never
 * splits a character.
 */
export function encodeInfo(i: BleInfo): string {
  const host = str(i.host) ? i.host : '';
  const title = str(i.title) ? i.title : '';
  const base = utf8Length(infoJson(i, '', ''));
  const room = Math.max(0, MAX_INFO_BYTES - base);
  const hostBytes = jsonStringBytes(host);
  const fitTitle = fitJsonString(title, Math.max(0, room - hostBytes));
  const fitHost = fitJsonString(host, room - jsonStringBytes(fitTitle));
  return infoJson(i, fitHost, fitTitle);
}

/** The INFO, or null for a text that is not a valid INFO of this version. */
export function decodeInfo(text: unknown): BleInfo | null {
  const x = parseJson(text, MAX_INFO_BYTES);
  if (!isObj(x) || x.v !== RENDEZVOUS_VERSION) return null;
  if (!isSession(x.s) || !str(x.h) || !str(x.n) || (x.k !== 'v' && x.k !== 'a') || (x.p !== 'a' && x.p !== 'd')) return null;
  if (typeof x.c !== 'number' || !Number.isInteger(x.c) || x.c < 0 || x.c > 3) return null;
  return {
    v: 1,
    session: x.s,
    host: x.h,
    title: x.n,
    kind: x.k === 'a' ? 'audio' : 'video',
    platform: x.p === 'd' ? 'android' : 'apple',
    canHotspot: (x.c & 1) !== 0,
    canJoinWifi: (x.c & 2) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Messages

export type RendezvousMessage =
  /**
   * Both directions. The guest sends `name` (and `memberId` when it has one).
   * The host sends `session` (and its `name`).
   */
  | {
      t: 'hello';
      pub: string;
      platform: Platform;
      canHotspot: boolean;
      canJoinWifi: boolean;
      name?: string;
      memberId?: string;
      session?: string;
    }
  /** Guest to host, sealed `JoinBody`. */
  | { t: 'join'; box: string }
  /** Host to guest, sealed `AcceptBody`. */
  | { t: 'accept'; box: string }
  /** Host to guest. */
  | { t: 'decline'; reason: string }
  /** The maker to the other side, sealed `WifiBody`. */
  | { t: 'wifi'; box: string }
  /** Host to guest, sealed `AddrBody`. */
  | { t: 'addr'; box: string }
  /** Both directions: the sender stopped. `reason` is a `FailReason` or another short code. */
  | { t: 'error'; reason: string };

export type RendezvousMessageType = RendezvousMessage['t'];

/** The sealed bodies. Each body also holds its message type, so a box cannot be used as a different message. */
export interface JoinBody {
  name: string;
  /** The guest has the item downloaded. */
  have: boolean;
}
export interface AcceptBody {
  /** 20 hex. The guest gives it on the TCP link, so the host lets it in with no second question. */
  rejoinKey: string;
  maker: 'host' | 'guest';
}
export interface WifiBody {
  ssid: string;
  password: string;
}
export interface AddrBody {
  /** IPv4, dotted. */
  addrs: string[];
  port: number;
}

function validMessage(x: Record<string, unknown>): boolean {
  switch (x.t) {
    case 'hello':
      return (
        isPublicKey(x.pub) &&
        isPlatform(x.platform) &&
        bool(x.canHotspot) &&
        bool(x.canJoinWifi) &&
        (x.name === undefined || isName(x.name)) &&
        (x.memberId === undefined || (str(x.memberId) && x.memberId.length <= 100)) &&
        (x.session === undefined || isSession(x.session))
      );
    case 'join':
    case 'accept':
    case 'wifi':
    case 'addr':
      return isBox(x.box);
    case 'decline':
    case 'error':
      return str(x.reason) && x.reason.length <= 200;
    default:
      return false;
  }
}

export function encodeRendezvous(message: RendezvousMessage): string {
  return JSON.stringify({ v: RENDEZVOUS_VERSION, ...message });
}

/** The message, or null for a text that is not a valid message of this version (or longer than 4096 bytes). */
export function decodeRendezvous(text: unknown): RendezvousMessage | null {
  const raw = parseJson(text, MAX_MESSAGE_BYTES);
  if (!isObj(raw) || raw.v !== RENDEZVOUS_VERSION || !str(raw.t) || !validMessage(raw)) return null;
  const { v: _v, ...rest } = raw;
  return rest as unknown as RendezvousMessage;
}

export function decodeJoinBody(x: unknown): JoinBody | null {
  return isObj(x) && x.t === 'join' && isName(x.name) && bool(x.have) ? { name: x.name, have: x.have } : null;
}
export function decodeAcceptBody(x: unknown): AcceptBody | null {
  return isObj(x) && x.t === 'accept' && isRejoinKey(x.rejoinKey) && (x.maker === 'host' || x.maker === 'guest')
    ? { rejoinKey: x.rejoinKey, maker: x.maker }
    : null;
}
export function decodeWifiBody(x: unknown): WifiBody | null {
  return isObj(x) && x.t === 'wifi' && str(x.ssid) && x.ssid.length >= 1 && utf8Length(x.ssid) <= 32 && str(x.password) && x.password.length <= 128
    ? { ssid: x.ssid, password: x.password }
    : null;
}
export function decodeAddrBody(x: unknown): AddrBody | null {
  return isObj(x) && x.t === 'addr' && Array.isArray(x.addrs) && x.addrs.length >= 1 && x.addrs.length <= 8 && x.addrs.every(isIPv4) && isPort(x.port)
    ? { addrs: [...(x.addrs as string[])], port: x.port }
    : null;
}

// ---------------------------------------------------------------------------
// Maker

/**
 * The device that makes the Wi-Fi: the Android device that can make a
 * hotspot, when the other device can join Wi-Fi. The host first. Null when no
 * device can do it (for example two Apple devices: they connect directly).
 */
export function chooseMaker(host: Caps, guest: Caps): 'host' | 'guest' | null {
  const canMake = (c: Caps) => c.platform === 'android' && c.canHotspot;
  if (canMake(host) && guest.canJoinWifi) return 'host';
  if (canMake(guest) && host.canJoinWifi) return 'guest';
  return null;
}

// ---------------------------------------------------------------------------
// State machine

export type RendezvousState =
  /** Guest: before `start`. */
  | 'idle'
  /** Waiting for the peer's `hello`. */
  | 'waiting-hello'
  /** Host: waiting for the guest's `join`. */
  | 'waiting-join'
  /** Host: the host person sees the join request. */
  | 'approving'
  /** Guest: waiting for `accept` or `decline`. */
  | 'waiting-approval'
  /** This side starts its hotspot. */
  | 'making-wifi'
  /** Waiting for the maker's `wifi`. */
  | 'waiting-wifi'
  /** This side joins the maker's Wi-Fi. */
  | 'joining-wifi'
  /** Host: waiting for the caller's ADDRESSES. */
  | 'sharing-addr'
  /** Guest: waiting for the host's `addr`. */
  | 'waiting-addr'
  /** Guest: the TCP connect runs. */
  | 'connecting'
  /** Host: waiting for the guest on TCP (the caller sends CONNECTED). */
  | 'waiting-guest'
  | 'done'
  | 'failed';

export type FailReason =
  | 'needs-wifi'
  | 'declined'
  | 'hotspot'
  | 'wifi'
  | 'connect'
  | 'timeout'
  | 'link-lost'
  | 'cancelled'
  | 'peer-error'
  | 'protocol'
  | 'setup';

const PEER_REASONS: readonly FailReason[] = ['needs-wifi', 'hotspot', 'wifi', 'connect', 'timeout', 'cancelled', 'protocol', 'setup'];

export type RendezvousEvent =
  | { type: 'MESSAGE'; text: string }
  | { type: 'APPROVE' }
  | { type: 'DECLINE'; reason?: string }
  | { type: 'HOTSPOT_READY'; ssid: string; password: string }
  | { type: 'HOTSPOT_FAILED'; message?: string }
  | { type: 'WIFI_JOINED' }
  | { type: 'WIFI_FAILED'; message?: string }
  | { type: 'ADDRESSES'; addrs: string[]; port: number }
  | { type: 'CONNECTED' }
  | { type: 'CONNECT_FAILED'; message?: string }
  | { type: 'TIMEOUT' }
  | { type: 'LINK_LOST' }
  | { type: 'CANCEL' };

export type RendezvousEffect =
  /** Send this text over BLE to the peer. */
  | { type: 'send'; text: string }
  /** Host: show the join request. Answer with APPROVE or DECLINE. */
  | { type: 'askApproval'; name: string; have: boolean }
  /** Start the hotspot. Answer with HOTSPOT_READY or HOTSPOT_FAILED. */
  | { type: 'startHotspot' }
  /** Join this Wi-Fi. Answer with WIFI_JOINED or WIFI_FAILED. */
  | { type: 'joinWifi'; ssid: string; password: string }
  /** Host: give this device's IPv4 addresses on the new network and the session port with ADDRESSES. */
  | { type: 'needAddresses' }
  /** Guest: open the TCP session (try the addresses in order). Answer with CONNECTED or CONNECT_FAILED. */
  | { type: 'connect'; addrs: string[]; port: number; rejoinKey: string }
  /** Short copy for the UI. */
  | { type: 'progress'; text: string }
  /** Replace the deadline: send TIMEOUT after `ms`. Stop the timer after `done` or `fail`. */
  | { type: 'setTimer'; ms: number }
  | { type: 'done' }
  | { type: 'fail'; reason: FailReason; message: string };

export interface RendezvousSelf extends Caps {
  name: string;
  memberId?: string;
}

export interface RendezvousOptions {
  role: 'host' | 'guest';
  self: RendezvousSelf;
  /** Host: the session id (8 hex). Guest: the session id from INFO, to check the host's `hello`. */
  session?: string;
  /** Host: the rejoin key (20 hex) for this guest. */
  rejoinKey?: string;
  /** Guest: the host's name from INFO, for the UI copy. */
  hostName?: string;
  /** Guest: this device has the item downloaded. */
  have?: boolean;
  keyPair: KeyPair;
  random: Random;
}

/** What this side knows about the peer. */
export interface RendezvousPeer extends Caps {
  name: string;
  memberId?: string;
  /** Host: the guest has the item downloaded. */
  have?: boolean;
}

export interface Rendezvous {
  readonly role: 'host' | 'guest';
  readonly state: RendezvousState;
  /** The peer, after its `hello`. */
  readonly peer: RendezvousPeer | null;
  /** The device that makes the Wi-Fi, after `accept`. */
  readonly maker: 'host' | 'guest' | null;
  /** Why the rendezvous failed (state 'failed'). */
  readonly failure: { reason: FailReason; message: string } | null;
  start(): RendezvousEffect[];
  handle(event: RendezvousEvent): RendezvousEffect[];
}

/** The states where the BLE link is no longer necessary: a BLE disconnect there is not a failure. */
const LINK_FREE: readonly RendezvousState[] = ['connecting', 'waiting-guest'];
/** Guest: the states where the host's `addr` can come. */
const ADDR_STATES: readonly RendezvousState[] = ['waiting-wifi', 'joining-wifi', 'making-wifi', 'waiting-addr'];

export function createRendezvous(opts: RendezvousOptions): Rendezvous {
  const { role, self, keyPair, random } = opts;
  let state: RendezvousState = role === 'host' ? 'waiting-hello' : 'idle';
  let started = false;
  let key: Uint8Array | null = null;
  let peer: RendezvousPeer | null = null;
  let maker: 'host' | 'guest' | null = null;
  let failure: { reason: FailReason; message: string } | null = null;
  let rejoinKey: string | null = role === 'host' && isRejoinKey(opts.rejoinKey) ? opts.rejoinKey : null;
  let ssid = '';
  let addr: AddrBody | null = null;
  /** Guest: the Wi-Fi is ready on this side (joined, or made by this side). */
  let onWifi = false;

  const peerName = () => (role === 'guest' ? opts.hostName || peer?.name || 'the host' : peer?.name || 'the guest');
  const send = (m: RendezvousMessage): RendezvousEffect => ({ type: 'send', text: encodeRendezvous(m) });
  const sealed = (t: 'join' | 'accept' | 'wifi' | 'addr', body: object): RendezvousEffect | null => {
    if (!key) return null;
    const box = seal(key, { t, ...body }, random);
    return box ? send({ t, box } as RendezvousMessage) : null;
  };
  const opened = (box: string): unknown => (key ? open(key, box) : null);
  const progress = (text: string): RendezvousEffect => ({ type: 'progress', text });
  const timer = (ms: number): RendezvousEffect => ({ type: 'setTimer', ms });
  const terminal = () => state === 'done' || state === 'failed';

  function copy(reason: FailReason, fromPeer: boolean): string {
    const other = peerName();
    switch (reason) {
      case 'needs-wifi':
        return 'These devices cannot make a Wi-Fi link. Connect both devices to the same Wi-Fi network.';
      case 'declined':
        return role === 'guest' ? `${other} did not let you in.` : `You did not let ${other} in.`;
      case 'hotspot':
        return fromPeer ? `${other}'s phone cannot make a Wi-Fi link.` : 'This phone cannot make a Wi-Fi link.';
      case 'wifi':
        return fromPeer ? `${other} cannot join the Wi-Fi.` : ssid ? `This device cannot join the Wi-Fi “${ssid}”.` : 'This device cannot join the Wi-Fi.';
      case 'connect':
        return fromPeer ? `${other} cannot connect.` : `Cannot connect to ${other}.`;
      case 'timeout':
        return fromPeer ? `${other} stopped because this device did not answer in time.` : `${other} does not answer.`;
      case 'link-lost':
        return `The Bluetooth link to ${other} is lost.`;
      case 'cancelled':
        return fromPeer ? `${other} stopped.` : 'Stopped.';
      case 'protocol':
        return fromPeer ? `${other} cannot read the messages of this device.` : `${other} sent a message that is not correct.`;
      case 'setup':
        return 'The Bluetooth link is not set up correctly.';
      case 'peer-error':
      default:
        return `${other} stopped.`;
    }
  }

  /** Go to 'failed'. Tell the peer when the link is still there and the peer did not stop first. */
  function fail(reason: FailReason, opt: { tellPeer?: boolean; fromPeer?: boolean } = {}): RendezvousEffect[] {
    const message = copy(reason, opt.fromPeer ?? false);
    const out: RendezvousEffect[] = [];
    if (opt.tellPeer ?? true) out.push(send({ t: 'error', reason }));
    state = 'failed';
    failure = { reason, message };
    out.push({ type: 'fail', reason, message });
    return out;
  }

  function finish(): RendezvousEffect[] {
    state = 'done';
    return [progress('Connected.'), { type: 'done' }];
  }

  function helloOf(): RendezvousMessage {
    return {
      t: 'hello',
      pub: keyPair.pub,
      platform: self.platform,
      canHotspot: self.canHotspot,
      canJoinWifi: self.canJoinWifi,
      name: self.name,
      ...(role === 'guest' && self.memberId ? { memberId: self.memberId } : {}),
      ...(role === 'host' ? { session: opts.session } : {}),
    };
  }

  // -- Guest ---------------------------------------------------------------

  function guestTryConnect(): RendezvousEffect[] {
    if (!onWifi || !addr || !rejoinKey) return [];
    state = 'connecting';
    return [progress('Connecting…'), timer(TIMERS.connect), { type: 'connect', addrs: addr.addrs, port: addr.port, rejoinKey }];
  }

  function guestMessage(m: RendezvousMessage): RendezvousEffect[] {
    switch (m.t) {
      case 'hello': {
        if (state !== 'waiting-hello' || !isSession(m.session) || !m.name) return [];
        if (opts.session !== undefined && m.session !== opts.session) return fail('protocol');
        key = deriveKey(keyPair.priv, m.pub, m.session);
        peer = { name: m.name, platform: m.platform, canHotspot: m.canHotspot, canJoinWifi: m.canJoinWifi };
        if (!key) return fail('protocol');
        if (chooseMaker(peer, self) === null) return fail('needs-wifi');
        const join = sealed('join', { name: self.name, have: opts.have === true });
        if (!join) return fail('setup');
        state = 'waiting-approval';
        return [join, progress(`Asking ${peerName()} to let you in…`), timer(TIMERS.approval)];
      }
      case 'accept': {
        if (state !== 'waiting-approval') return [];
        const body = decodeAcceptBody(opened(m.box));
        if (!body) return [];
        if (body.maker === 'guest' && !(self.platform === 'android' && self.canHotspot)) return fail('protocol');
        if (body.maker === 'host' && !self.canJoinWifi) return fail('protocol');
        rejoinKey = body.rejoinKey;
        maker = body.maker;
        if (maker === 'guest') {
          state = 'making-wifi';
          return [progress('Making a Wi-Fi link…'), timer(TIMERS.wifi), { type: 'startHotspot' }];
        }
        state = 'waiting-wifi';
        return [progress(`Asking ${peerName()}'s phone to make a Wi-Fi link…`), timer(TIMERS.wifi)];
      }
      case 'decline':
        if (state !== 'waiting-approval') return [];
        return fail('declined', { tellPeer: false });
      case 'wifi': {
        if (state !== 'waiting-wifi') return [];
        const body = decodeWifiBody(opened(m.box));
        if (!body) return [];
        ssid = body.ssid;
        state = 'joining-wifi';
        return [progress(`Joining the Wi-Fi “${body.ssid}”…`), timer(TIMERS.wifi), { type: 'joinWifi', ssid: body.ssid, password: body.password }];
      }
      case 'addr': {
        if (addr || !maker || !ADDR_STATES.includes(state)) return [];
        const body = decodeAddrBody(opened(m.box));
        if (!body) return [];
        addr = body;
        return guestTryConnect();
      }
      default:
        return [];
    }
  }

  function guestEvent(e: RendezvousEvent): RendezvousEffect[] {
    switch (e.type) {
      case 'HOTSPOT_READY': {
        if (state !== 'making-wifi') return [];
        const body = { ssid: str(e.ssid) ? e.ssid : '', password: str(e.password) ? e.password : '' };
        if (!decodeWifiBody({ t: 'wifi', ...body })) return fail('hotspot');
        const wifi = sealed('wifi', body);
        if (!wifi) return fail('setup');
        ssid = body.ssid;
        onWifi = true;
        state = 'waiting-addr';
        // The host must join the Wi-Fi first, then it sends `addr`.
        return [wifi, progress(`Waiting for ${peerName()} to join the Wi-Fi…`), timer(TIMERS.wifi + TIMERS.answer)];
      }
      case 'HOTSPOT_FAILED':
        return state === 'making-wifi' ? fail('hotspot') : [];
      case 'WIFI_JOINED': {
        if (state !== 'joining-wifi') return [];
        onWifi = true;
        if (addr) return guestTryConnect();
        state = 'waiting-addr';
        return [progress('Connecting…'), timer(TIMERS.answer)];
      }
      case 'WIFI_FAILED':
        return state === 'joining-wifi' ? fail('wifi') : [];
      case 'CONNECTED':
        return state === 'connecting' ? finish() : [];
      case 'CONNECT_FAILED':
        return state === 'connecting' ? fail('connect', { tellPeer: true }) : [];
      default:
        return [];
    }
  }

  // -- Host ----------------------------------------------------------------

  function hostMessage(m: RendezvousMessage): RendezvousEffect[] {
    switch (m.t) {
      case 'hello': {
        if (state !== 'waiting-hello' || m.name === undefined || !isSession(opts.session)) return [];
        key = deriveKey(keyPair.priv, m.pub, opts.session);
        peer = { name: m.name, platform: m.platform, canHotspot: m.canHotspot, canJoinWifi: m.canJoinWifi, ...(m.memberId ? { memberId: m.memberId } : {}) };
        if (!key) return fail('protocol');
        const hello = send(helloOf());
        if (chooseMaker(self, peer) === null) return [hello, ...fail('needs-wifi')];
        state = 'waiting-join';
        return [hello, timer(TIMERS.answer)];
      }
      case 'join': {
        if (state !== 'waiting-join' || !peer) return [];
        const body = decodeJoinBody(opened(m.box));
        if (!body) return [];
        peer = { ...peer, name: body.name || peer.name, have: body.have };
        state = 'approving';
        return [timer(TIMERS.approval), { type: 'askApproval', name: peer.name, have: body.have }];
      }
      case 'wifi': {
        if (state !== 'waiting-wifi') return [];
        const body = decodeWifiBody(opened(m.box));
        if (!body) return [];
        ssid = body.ssid;
        state = 'joining-wifi';
        return [progress(`Joining the Wi-Fi “${body.ssid}”…`), timer(TIMERS.wifi), { type: 'joinWifi', ssid: body.ssid, password: body.password }];
      }
      default:
        return [];
    }
  }

  function hostEvent(e: RendezvousEvent): RendezvousEffect[] {
    switch (e.type) {
      case 'APPROVE': {
        if (state !== 'approving' || !peer) return [];
        const m = chooseMaker(self, peer);
        if (!m) return fail('needs-wifi');
        if (!rejoinKey) return fail('setup');
        const accept = sealed('accept', { rejoinKey, maker: m });
        if (!accept) return fail('setup');
        maker = m;
        if (m === 'host') {
          state = 'making-wifi';
          return [accept, progress('Making a Wi-Fi link…'), timer(TIMERS.wifi), { type: 'startHotspot' }];
        }
        state = 'waiting-wifi';
        return [accept, progress(`Asking ${peerName()}'s phone to make a Wi-Fi link…`), timer(TIMERS.wifi + TIMERS.answer)];
      }
      case 'DECLINE': {
        if (state !== 'approving') return [];
        const reason = str(e.reason) && e.reason.length <= 200 ? e.reason : 'declined';
        return [send({ t: 'decline', reason }), ...fail('declined', { tellPeer: false })];
      }
      case 'HOTSPOT_READY': {
        if (state !== 'making-wifi') return [];
        const body = { ssid: str(e.ssid) ? e.ssid : '', password: str(e.password) ? e.password : '' };
        if (!decodeWifiBody({ t: 'wifi', ...body })) return fail('hotspot');
        const wifi = sealed('wifi', body);
        if (!wifi) return fail('setup');
        ssid = body.ssid;
        state = 'sharing-addr';
        return [wifi, timer(TIMERS.answer), { type: 'needAddresses' }];
      }
      case 'HOTSPOT_FAILED':
        return state === 'making-wifi' ? fail('hotspot') : [];
      case 'WIFI_JOINED':
        if (state !== 'joining-wifi') return [];
        state = 'sharing-addr';
        return [timer(TIMERS.answer), { type: 'needAddresses' }];
      case 'WIFI_FAILED':
        return state === 'joining-wifi' ? fail('wifi') : [];
      case 'ADDRESSES': {
        if (state !== 'sharing-addr') return [];
        const body = decodeAddrBody({ t: 'addr', addrs: e.addrs, port: e.port });
        if (!body) return fail('setup');
        const msg = sealed('addr', body);
        if (!msg) return fail('setup');
        state = 'waiting-guest';
        // The guest may still join the Wi-Fi (host is the maker), then it connects.
        return [msg, progress('Connecting…'), timer(maker === 'host' ? TIMERS.wifi + TIMERS.connect : TIMERS.answer + TIMERS.connect)];
      }
      case 'CONNECTED':
        return state === 'waiting-guest' ? finish() : [];
      default:
        return [];
    }
  }

  // -- Both ----------------------------------------------------------------

  function handle(e: RendezvousEvent): RendezvousEffect[] {
    if (!isObj(e) || terminal()) return [];
    if (role === 'guest' && state === 'idle') {
      return e.type === 'CANCEL' ? fail('cancelled', { tellPeer: false }) : [];
    }
    switch (e.type) {
      case 'MESSAGE': {
        const m = decodeRendezvous(e.text);
        if (!m) return [];
        if (m.t === 'error') {
          const reason = (PEER_REASONS as readonly string[]).includes(m.reason) ? (m.reason as FailReason) : 'peer-error';
          return fail(reason, { tellPeer: false, fromPeer: true });
        }
        return role === 'host' ? hostMessage(m) : guestMessage(m);
      }
      case 'TIMEOUT':
        return fail('timeout');
      case 'LINK_LOST':
        return LINK_FREE.includes(state) ? [] : fail('link-lost', { tellPeer: false });
      case 'CANCEL':
        return fail('cancelled');
      default:
        return role === 'host' ? hostEvent(e) : guestEvent(e);
    }
  }

  /** Drops a progress effect with the same copy as the last one. */
  let lastProgress = '';
  function dedupe(effects: RendezvousEffect[]): RendezvousEffect[] {
    return effects.filter((e) => {
      if (e.type !== 'progress') return true;
      if (e.text === lastProgress) return false;
      lastProgress = e.text;
      return true;
    });
  }

  function start(): RendezvousEffect[] {
    if (started || terminal()) return [];
    started = true;
    if (role === 'host') {
      if (!isSession(opts.session) || !rejoinKey) return fail('setup', { tellPeer: false });
      return [timer(TIMERS.answer)];
    }
    if (opts.session !== undefined && !isSession(opts.session)) return fail('setup', { tellPeer: false });
    state = 'waiting-hello';
    return [send(helloOf()), timer(TIMERS.answer)];
  }

  return {
    role,
    get state() {
      return state;
    },
    get peer() {
      return peer;
    },
    get maker() {
      return maker;
    },
    get failure() {
      return failure;
    },
    start: () => dedupe(start()),
    handle: (e) => dedupe(handle(e)),
  };
}
