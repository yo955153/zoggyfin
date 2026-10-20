/**
 * The primitives of the rendezvous cryptography (see rendezvous-crypto.ts).
 * Two implementations give the same bytes:
 *
 * - `rendezvous-cipher.ts`: the audited @noble libraries in JS (Android, the
 *   web page of the Mac app, and the tests).
 * - `rendezvous-cipher.ios.ts`: Apple CryptoKit in the native module (iOS and
 *   iPadOS), so the iOS app uses only encryption from the operating system.
 *
 * The scheme: X25519, HKDF-SHA256 (32 bytes), ChaCha20-Poly1305 (IETF, 12-byte
 * nonce, 16-byte tag). No function throws: bad input gives null.
 */
export interface RendezvousCipher {
  /** Where the cryptography runs. */
  readonly impl: 'noble' | 'cryptokit';
  /** The X25519 public key of a 32-byte private key. */
  publicKey(priv: Uint8Array): Uint8Array | null;
  /** HKDF-SHA256 (32 bytes) of the X25519 shared secret. Null for a bad key or a zero shared secret. */
  sharedKey(priv: Uint8Array, peer: Uint8Array, salt: Uint8Array, info: Uint8Array): Uint8Array | null;
  /** ChaCha20-Poly1305: ciphertext || tag. */
  seal(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Uint8Array | null;
  /** The plaintext, or null when the tag does not match. */
  open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): Uint8Array | null;
}

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

/** The bytes of lower-case or upper-case hex, or null. */
export function fromHex(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}
