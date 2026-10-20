/**
 * The cryptography of the Bluetooth LE rendezvous (see rendezvous.ts).
 *
 * - Key agreement: X25519. Each side makes a new key pair for each rendezvous.
 * - Key derivation: HKDF-SHA256 of the X25519 shared secret. The salt is the
 *   8-hex session id (UTF-8), the info is "zgf-rendezvous-1", the output is 32 bytes.
 * - Sealed messages: XChaCha20-Poly1305 with a 24-byte random nonce. The
 *   plaintext is JSON (UTF-8). The box is base64url (no padding) of nonce || ciphertext.
 *
 * The libraries are the audited @noble packages, pinned to 1.x because 1.x
 * ships CommonJS (jest-expo) and works in Metro with no transform.
 * The caller injects the randomness (a native secure source in the app).
 * The functions in this file never throw on bad input: they return null.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Gives n cryptographically secure random bytes. Never use Math.random for it. */
export type Random = (n: number) => Uint8Array;

export interface KeyPair {
  /** The 32-byte X25519 private key. Keep it in memory only. */
  priv: Uint8Array;
  /** The X25519 public key, base64url (43 characters). */
  pub: string;
}

export const HKDF_INFO = 'zgf-rendezvous-1';
const NONCE_BYTES = 24;
const TAG_BYTES = 16;

// ---------------------------------------------------------------------------
// UTF-8 and base64url (no TextEncoder, TextDecoder or Buffer: Hermes does not
// have all of them on all versions).

/** The UTF-8 bytes of a string. A lone surrogate becomes U+FFFD (as TextEncoder does). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0) ?? 0xfffd;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

/** The number of UTF-8 bytes of one code point. */
export function utf8CodePointBytes(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/** The number of UTF-8 bytes of a string (the same count as utf8Encode). */
export function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) n += utf8CodePointBytes(ch.codePointAt(0) ?? 0xfffd);
  return n;
}

/** The text of strict UTF-8 bytes, or null for bytes that are not valid UTF-8. */
export function utf8Decode(bytes: Uint8Array): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    let need: number;
    let min: number;
    if (b < 0x80) {
      cp = b;
      need = 0;
      min = 0;
    } else if ((b & 0xe0) === 0xc0) {
      cp = b & 0x1f;
      need = 1;
      min = 0x80;
    } else if ((b & 0xf0) === 0xe0) {
      cp = b & 0x0f;
      need = 2;
      min = 0x800;
    } else if ((b & 0xf8) === 0xf0) {
      cp = b & 0x07;
      need = 3;
      min = 0x10000;
    } else {
      return null;
    }
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i;

/** base64url with no padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
  }
  return out;
}

/** The bytes of canonical base64url with no padding, or null for any other text. */
export function fromBase64Url(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64_INDEX[text[i]];
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  // The bits that are left over must be zero (canonical form).
  if ((acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

// ---------------------------------------------------------------------------

function randomBytes(random: Random, n: number): Uint8Array | null {
  try {
    const r = random(n);
    return r instanceof Uint8Array && r.length === n ? r : null;
  } catch {
    return null;
  }
}

/** A new X25519 key pair. Throws only when `random` does not give 32 bytes (a setup error). */
export function generateKeyPair(random: Random): KeyPair {
  const seed = randomBytes(random, 32);
  if (!seed) throw new Error('The random source did not give 32 bytes.');
  const priv = Uint8Array.from(seed);
  return { priv, pub: toBase64Url(x25519.getPublicKey(priv)) };
}

/** True for a base64url text of 32 bytes (an X25519 public key). */
export function isPublicKey(x: unknown): x is string {
  return typeof x === 'string' && x.length === 43 && fromBase64Url(x)?.length === 32;
}

/**
 * The shared 32-byte key, or null when the peer's public key is bad
 * (bad base64url, wrong length, or a low-order point that gives a zero secret).
 */
export function deriveKey(priv: Uint8Array, peerPub: string, session: string): Uint8Array | null {
  const peer = isPublicKey(peerPub) ? fromBase64Url(peerPub) : null;
  if (!peer || !(priv instanceof Uint8Array) || priv.length !== 32) return null;
  try {
    const shared = x25519.getSharedSecret(priv, peer);
    if (shared.every((b) => b === 0)) return null;
    return hkdf(sha256, shared, utf8Encode(session), utf8Encode(HKDF_INFO), 32);
  } catch {
    return null;
  }
}

/**
 * Seals a JSON value. Returns base64url(nonce || ciphertext), or an empty
 * string when the value is not JSON or the key or the randomness is bad.
 */
export function seal(key: Uint8Array, value: unknown, random: Random): string {
  if (!(key instanceof Uint8Array) || key.length !== 32) return '';
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return '';
  }
  if (json === undefined) return '';
  const nonce = randomBytes(random, NONCE_BYTES);
  if (!nonce) return '';
  try {
    const sealed = xchacha20poly1305(key, nonce).encrypt(utf8Encode(json));
    const out = new Uint8Array(NONCE_BYTES + sealed.length);
    out.set(nonce, 0);
    out.set(sealed, NONCE_BYTES);
    return toBase64Url(out);
  } catch {
    return '';
  }
}

/** The JSON value in a box, or null on any failure (tamper, wrong key, bad base64url, bad UTF-8, bad JSON). */
export function open(key: Uint8Array, box: unknown): unknown | null {
  if (!(key instanceof Uint8Array) || key.length !== 32) return null;
  const bytes = fromBase64Url(box);
  if (!bytes || bytes.length < NONCE_BYTES + TAG_BYTES) return null;
  try {
    const plain = xchacha20poly1305(key, bytes.subarray(0, NONCE_BYTES)).decrypt(bytes.subarray(NONCE_BYTES));
    const text = utf8Decode(plain);
    if (text === null) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
