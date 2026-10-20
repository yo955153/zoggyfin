/**
 * The join code of a nearby session. A guest uses it to connect to a host
 * when discovery does not work: for example a hotel or plane Wi-Fi that does
 * not let devices see each other, or a network with no Bonjour for Android.
 *
 * There are two forms:
 *
 * - The join link (in a QR code): `zoggyfin://join?v=1&a=<addrs>&p=<port>&s=<session>&k=<key>[&n=<name>]`.
 *   It has all the host addresses and the full session key.
 * - The short code (to type): the first address, the port and the first
 *   4 bytes of the key, in 16 Crockford base32 characters and 1 check
 *   character: `ABCD-EFGH-JKMN-PQRS-T`.
 *
 * The parse functions never throw on bad input; they return null.
 */
import type { LinkAddress } from './link-native-types';

export const JOIN_VERSION = 1;
/** The maximum length of the host name in a join link (characters). */
export const MAX_NAME = 30;
/** The maximum length of a join link that `joinLink` makes. */
export const MAX_LINK = 300;
/** `parseJoinLink` rejects longer input. */
export const MAX_INPUT = 512;
export const MAX_ADDRS = 4;

export interface JoinPayload {
  v: 1;
  /** 1 to 4 IPv4 addresses, dotted. */
  addrs: string[];
  port: number;
  /** 8 lowercase hex characters: the short form of the session id. */
  session: string;
  /** 20 lowercase hex characters (80 random bits): the session token. */
  key: string;
  /** The host name, at most 30 characters. */
  name?: string;
}

const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
const SESSION = /^[0-9a-f]{8}$/;
const KEY = /^[0-9a-f]{20}$/;
const PORT = /^[1-9][0-9]{0,4}$/;

/** True for a dotted IPv4 address with octets 0-255 and no leading zeros. */
export function isIpv4(s: string): boolean {
  return IPV4.test(s);
}

function validPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function hex(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  return out;
}

/** A new session key: 10 random bytes as 20 lowercase hex characters. `random(n)` gives n random bytes. */
export function newSessionKey(random: (n: number) => Uint8Array): string {
  const bytes = random(10);
  if (bytes.length < 10) throw new Error('newSessionKey: random() gave fewer than 10 bytes');
  return hex(bytes.subarray(0, 10));
}

/** The short form of a session id: the first 8 hex characters, with the dashes removed, lowercase. */
export function shortSession(sessionId: string): string {
  return sessionId.replace(/-/g, '').toLowerCase().slice(0, 8);
}

/** The code points of a string (a surrogate pair is one item). */
function chars(s: string): string[] {
  return Array.from(s);
}

function validPayload(p: JoinPayload): boolean {
  return (
    p.v === JOIN_VERSION &&
    Array.isArray(p.addrs) &&
    p.addrs.length >= 1 &&
    p.addrs.length <= MAX_ADDRS &&
    p.addrs.every((a) => typeof a === 'string' && isIpv4(a)) &&
    validPort(p.port) &&
    SESSION.test(p.session) &&
    KEY.test(p.key) &&
    (p.name === undefined || typeof p.name === 'string')
  );
}

/**
 * Makes the join link. The name is trimmed and cut to 30 characters, and
 * cut more when its URL encoding makes the link longer than 300 characters.
 * An empty name is left out.
 *
 * Throws only on a programmer error: a payload with a bad field.
 */
export function joinLink(p: JoinPayload): string {
  if (!validPayload(p)) throw new Error('joinLink: invalid payload');
  const base = `zoggyfin://join?v=${JOIN_VERSION}&a=${p.addrs.join(',')}&p=${p.port}&s=${p.session}&k=${p.key}`;
  let name = chars((p.name ?? '').trim()).slice(0, MAX_NAME);
  while (name.length > 0) {
    const link = `${base}&n=${encodeURIComponent(name.join(''))}`;
    if (link.length <= MAX_LINK) return link;
    name = name.slice(0, -1);
  }
  return base;
}

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * Reads a join link. Accepts `zoggyfin://join?...` and `zoggyfin:///join?...`
 * (Expo Linking can make the second form). Unknown parameters are ignored.
 * Returns null for another scheme or host, another version, a bad or
 * repeated field, or input longer than 512 characters.
 */
export function parseJoinLink(url: string): JoinPayload | null {
  if (typeof url !== 'string' || url.length > MAX_INPUT) return null;
  const m = /^zoggyfin:\/\/\/?join\?([^#]*)(#.*)?$/i.exec(url.trim());
  if (!m) return null;
  const fields = new Map<string, string>();
  for (const part of m[1].split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const k = part.slice(0, eq);
    const v = decode(part.slice(eq + 1));
    if (v === null || fields.has(k)) return null;
    fields.set(k, v);
  }
  if (fields.get('v') !== String(JOIN_VERSION)) return null;

  const a = fields.get('a');
  if (!a) return null;
  const addrs = a.split(',');
  if (addrs.length > MAX_ADDRS || !addrs.every(isIpv4)) return null;

  const portText = fields.get('p') ?? '';
  if (!PORT.test(portText)) return null;
  const port = Number(portText);
  if (!validPort(port)) return null;

  const session = fields.get('s') ?? '';
  const key = fields.get('k') ?? '';
  if (!SESSION.test(session) || !KEY.test(key)) return null;

  const out: JoinPayload = { v: 1, addrs, port, session, key };
  const name = fields.get('n');
  if (name !== undefined) {
    if (chars(name).length > MAX_NAME) return null;
    if (name !== '') out.name = name;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Short code
// ---------------------------------------------------------------------------

/** Crockford base32: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The check character: (sum of (2i + 1) * value_i) mod 32, over the 16 data
 * characters (i = 0 ... 15), shown as one more base32 character. Each weight
 * is odd, so each change of one character changes the check. Most swaps of
 * two near characters change it too.
 */
function checkValue(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (2 * i + 1) * values[i];
  return sum % 32;
}

/** 10 bytes (80 bits) to 16 base32 values (5 bits each, most significant first). */
function toBase32(bytes: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/** 16 base32 values to 10 bytes. */
function fromBase32(values: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/**
 * The short code to type: the first address (4 bytes), the port (2 bytes)
 * and the first 4 bytes of the key, as `XXXX-XXXX-XXXX-XXXX-C`.
 *
 * Throws only on a programmer error: a payload with a bad field.
 */
export function shortCode(p: JoinPayload): string {
  if (!validPayload(p)) throw new Error('shortCode: invalid payload');
  const bytes = [
    ...p.addrs[0].split('.').map(Number),
    (p.port >> 8) & 0xff,
    p.port & 0xff,
    ...[0, 2, 4, 6].map((i) => parseInt(p.key.slice(i, i + 2), 16)),
  ];
  const values = toBase32(bytes);
  const text = values.map((v) => ALPHABET[v]).join('') + ALPHABET[checkValue(values)];
  return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16)}`;
}

export interface ShortCodeData {
  addr: string;
  port: number;
  /** The first 8 hex characters of the key, lowercase. */
  keyPrefix: string;
}

/**
 * Reads a short code. Ignores case, spaces and dashes. Reads I and L as 1,
 * and O as 0. Returns null for a bad length, a bad character, a bad check
 * character or port 0.
 */
export function parseShortCode(text: string): ShortCodeData | null {
  if (typeof text !== 'string' || text.length > 64) return null;
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (clean.length !== 17) return null;
  const values: number[] = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  const check = values.pop();
  if (check !== checkValue(values)) return null;
  const bytes = fromBase32(values);
  const port = (bytes[4] << 8) | bytes[5];
  if (port === 0) return null;
  return { addr: bytes.slice(0, 4).join('.'), port, keyPrefix: hex(bytes.slice(6, 10)) };
}

/**
 * True when `given` is the full key (20 characters) or its first 8
 * characters. Other lengths, and an empty value, give false. The compare
 * takes the same time for each value of the same length.
 */
export function keyMatches(given: string, expected: string): boolean {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (expected.length !== 20) return false;
  if (given.length !== 20 && given.length !== 8) return false;
  const want = expected.slice(0, given.length);
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

const KIND_ORDER: Record<LinkAddress['kind'], number> = { hotspot: 0, wifi: 1, ethernet: 2, other: 3 };

/**
 * The addresses for the join code: hotspot first, then Wi-Fi, then ethernet,
 * then other. Removes the same address when it comes again, addresses that
 * are not IPv4, and loopback (127.x.x.x). At most 4.
 */
export function pickCodeAddress(addrs: LinkAddress[]): LinkAddress[] {
  const seen = new Set<string>();
  const ok = addrs.filter((a) => {
    if (!isIpv4(a.address) || a.address.startsWith('127.') || seen.has(a.address)) return false;
    seen.add(a.address);
    return true;
  });
  return ok
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (KIND_ORDER[x.a.kind] ?? 3) - (KIND_ORDER[y.a.kind] ?? 3) || x.i - y.i)
    .slice(0, MAX_ADDRS)
    .map((x) => x.a);
}

function escapeWifi(s: string): string {
  return s.replace(/[\\;,:"]/g, (c) => `\\${c}`);
}

/**
 * The text of a Wi-Fi QR code (the ZXing format that the iOS and Android
 * cameras read). An empty password gives an open network (`T:nopass`).
 */
export function wifiQr(ssid: string, password: string): string {
  if (!password) return `WIFI:T:nopass;S:${escapeWifi(ssid)};;`;
  return `WIFI:T:WPA;S:${escapeWifi(ssid)};P:${escapeWifi(password)};;`;
}
