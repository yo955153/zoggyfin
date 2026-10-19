/**
 * Secure random bytes for the one-time password. The web and the desktop
 * app have `crypto.getRandomValues`. On iOS and Android expo-crypto gives
 * them (loaded only when the app binary has it), else the nearby module. With no secure source the app does not make an invite:
 * Math.random is not safe for a password.
 */
import { requireOptionalNativeModule } from 'expo';

type GetRandom = (n: number) => Uint8Array;

function fromWebCrypto(): GetRandom | null {
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') return null;
  return (n) => c.getRandomValues!(new Uint8Array(n));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function fromExpoCrypto(): GetRandom | null {
  const mod = requireOptionalNativeModule<{ getRandomValues?: (b: Uint8Array) => void }>('ExpoCrypto');
  if (!mod || typeof mod.getRandomValues !== 'function') return null;
  return (n) => {
    const bytes = new Uint8Array(n);
    mod.getRandomValues!(bytes);
    return bytes;
  };
}

function fromNative(): GetRandom | null {
  const mod = requireOptionalNativeModule<{ randomBytes?: (n: number) => string }>('ZoggyfinTogether');
  if (!mod || typeof mod.randomBytes !== 'function') return null;
  return (n) => {
    const bytes = decodeBase64(mod.randomBytes!(n));
    if (bytes.length !== n) throw new Error('The random source does not work.');
    return bytes;
  };
}

/** The secure random source, or null when this app version has none. */
export function secureRandom(): GetRandom | null {
  return fromWebCrypto() ?? fromExpoCrypto() ?? fromNative();
}
