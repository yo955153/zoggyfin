/**
 * The rendezvous primitives on iOS and iPadOS: Apple CryptoKit in the native
 * module (`modules/zoggyfin-native/ios/RendezvousCrypto.swift`). The iOS app
 * uses only encryption from the operating system, so it is exempt from the
 * export rules and `ITSAppUsesNonExemptEncryption` stays false. This file
 * must not import @noble.
 *
 * A build with no rv* functions (an older build that gets this code over the
 * air) gives null for everything, so the Bluetooth rendezvous fails safely.
 */
import { requireOptionalNativeModule } from 'expo';

import { fromHex, NONCE_BYTES, type RendezvousCipher, TAG_BYTES, toHex } from './rendezvous-cipher-types';

export interface CryptoKitNative {
  rvPublicKey(privHex: string): string;
  rvSharedKey(privHex: string, peerHex: string, saltHex: string, infoHex: string): string;
  rvSeal(keyHex: string, nonceHex: string, plainHex: string): string;
  rvOpen(keyHex: string, nonceHex: string, sealedHex: string): string | null;
}

const is = (x: unknown, n?: number): x is Uint8Array => x instanceof Uint8Array && (n === undefined || x.length === n);

/** The CryptoKit cipher over a native module. Exported for the tests. */
export function cryptoKitCipher(native: Partial<CryptoKitNative> | null): RendezvousCipher {
  const call = (fn: () => string | null | undefined): Uint8Array | null => {
    try {
      const out = fn();
      return typeof out === 'string' && out.length > 0 ? fromHex(out) : null;
    } catch {
      return null;
    }
  };
  const ok = !!native && typeof native.rvSeal === 'function' && typeof native.rvOpen === 'function' && typeof native.rvSharedKey === 'function' && typeof native.rvPublicKey === 'function';
  const m = native as CryptoKitNative;
  return {
    impl: 'cryptokit',
    publicKey: (priv) => (ok && is(priv, 32) ? call(() => m.rvPublicKey(toHex(priv))) : null),
    sharedKey: (priv, peer, salt, info) => (ok && is(priv, 32) && is(peer, 32) && is(salt) && is(info) ? call(() => m.rvSharedKey(toHex(priv), toHex(peer), toHex(salt), toHex(info))) : null),
    seal: (key, nonce, plain) => (ok && is(key, 32) && is(nonce, NONCE_BYTES) && is(plain) ? call(() => m.rvSeal(toHex(key), toHex(nonce), toHex(plain))) : null),
    open: (key, nonce, sealed) => {
      if (!ok || !is(key, 32) || !is(nonce, NONCE_BYTES) || !is(sealed) || sealed.length < TAG_BYTES) return null;
      // An empty plaintext is valid: the native side gives "" for it and null for a bad tag.
      try {
        const out = m.rvOpen(toHex(key), toHex(nonce), toHex(sealed));
        return typeof out === 'string' ? fromHex(out) : null;
      } catch {
        return null;
      }
    },
  };
}

export const cipher: RendezvousCipher = cryptoKitCipher(requireOptionalNativeModule<CryptoKitNative>('ZoggyfinTogether'));
