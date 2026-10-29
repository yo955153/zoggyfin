/**
 * The rendezvous primitives with the audited @noble libraries (Android, the
 * web page of the Mac app, and the tests). iOS uses rendezvous-cipher.ios.ts
 * (CryptoKit). The libraries are ESM only, so Jest transforms them
 * (`@noble` in `transformIgnorePatterns`). They never draw random bytes here:
 * the caller gives the key seed and the nonce.
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { NONCE_BYTES, type RendezvousCipher, TAG_BYTES } from './rendezvous-cipher-types';

const is = (x: unknown, n?: number): x is Uint8Array => x instanceof Uint8Array && (n === undefined || x.length === n);

export const cipher: RendezvousCipher = {
  impl: 'noble',
  publicKey(priv) {
    if (!is(priv, 32)) return null;
    try {
      return x25519.getPublicKey(priv);
    } catch {
      return null;
    }
  },
  sharedKey(priv, peer, salt, info) {
    if (!is(priv, 32) || !is(peer, 32) || !is(salt) || !is(info)) return null;
    try {
      const shared = x25519.getSharedSecret(priv, peer);
      if (shared.every((b) => b === 0)) return null;
      return hkdf(sha256, shared, salt, info, 32);
    } catch {
      return null;
    }
  },
  seal(key, nonce, plain) {
    if (!is(key, 32) || !is(nonce, NONCE_BYTES) || !is(plain)) return null;
    try {
      return chacha20poly1305(key, nonce).encrypt(plain);
    } catch {
      return null;
    }
  },
  open(key, nonce, sealed) {
    if (!is(key, 32) || !is(nonce, NONCE_BYTES) || !is(sealed) || sealed.length < TAG_BYTES) return null;
    try {
      return chacha20poly1305(key, nonce).decrypt(sealed);
    } catch {
      return null;
    }
  },
};
