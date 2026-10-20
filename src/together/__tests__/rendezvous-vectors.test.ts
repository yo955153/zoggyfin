/**
 * Cross-implementation test vectors of the rendezvous cryptography. The same
 * JSON file is checked against CryptoKit by `pnpm test:crypto-swift`
 * (scripts/rendezvous-vectors/main.swift), so JS (@noble, Android) and Swift
 * (CryptoKit, iOS) give the same bytes. The keys are the RFC 7748 section 6.1 keys.
 */
import { cipher as noble } from '../rendezvous-cipher';
import { fromHex, type RendezvousCipher, toHex } from '../rendezvous-cipher-types';
import { cryptoKitCipher, type CryptoKitNative } from '../rendezvous-cipher.ios';
import { deriveKey, generateKeyPair, open, seal, setCipherForTests, toBase64Url, utf8Encode } from '../rendezvous-crypto';
import vectors from './rendezvous-vectors.json';

const b = (hex: string) => fromHex(hex)!;

describe('rendezvous test vectors (@noble)', () => {
  it('gives the RFC 7748 public keys and shared secret', () => {
    expect(toHex(noble.publicKey(b(vectors.a))!)).toBe(vectors.aPub);
    expect(toHex(noble.publicKey(b(vectors.b))!)).toBe(vectors.bPub);
    expect(vectors.shared).toBe('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
  });

  it('derives the key on both sides', () => {
    const salt = utf8Encode(vectors.session);
    const info = utf8Encode(vectors.info);
    expect(toHex(noble.sharedKey(b(vectors.a), b(vectors.bPub), salt, info)!)).toBe(vectors.key);
    expect(toHex(noble.sharedKey(b(vectors.b), b(vectors.aPub), salt, info)!)).toBe(vectors.key);
  });

  it('seals and opens every message with the fixed nonces', () => {
    for (const m of vectors.messages) {
      expect(toHex(noble.seal(b(vectors.key), b(m.nonce), b(m.plain))!)).toBe(m.sealed);
      expect(toHex(noble.open(b(vectors.key), b(m.nonce), b(m.sealed))!)).toBe(m.plain);
      expect(toHex(b(m.plain))).toBe(toHex(utf8Encode(m.text)));
    }
  });

  it('uses the IETF cipher: a 12-byte nonce, the box is nonce || ciphertext || tag', () => {
    const m = vectors.messages[0];
    const fixed = (n: number) => (n === 12 ? b(m.nonce) : new Uint8Array(n));
    const box = seal(b(vectors.key), JSON.parse(m.text), fixed);
    expect(box).toBe(toBase64Url(b(m.nonce + m.sealed)));
    expect(open(b(vectors.key), box)).toEqual(JSON.parse(m.text));
  });
});

/** A fake native module that runs the CryptoKit API on @noble, to test the iOS glue. */
function fakeNative(): CryptoKitNative {
  return {
    rvPublicKey: (p) => toHex(noble.publicKey(b(p)) ?? new Uint8Array()),
    rvSharedKey: (p, q, s, i) => toHex(noble.sharedKey(b(p), b(q), b(s), b(i)) ?? new Uint8Array()),
    rvSeal: (k, n, p) => toHex(noble.seal(b(k), b(n), b(p)) ?? new Uint8Array()),
    rvOpen: (k, n, s) => {
      const out = noble.open(b(k), b(n), b(s));
      return out ? toHex(out) : null;
    },
  };
}

describe('the iOS cipher glue (rendezvous-cipher.ios.ts)', () => {
  let old: RendezvousCipher | null = null;
  afterEach(() => {
    if (old) setCipherForTests(old);
    old = null;
  });

  it('gives the vector bytes through the native API', () => {
    const ck = cryptoKitCipher(fakeNative());
    expect(ck.impl).toBe('cryptokit');
    expect(toHex(ck.publicKey(b(vectors.a))!)).toBe(vectors.aPub);
    const key = ck.sharedKey(b(vectors.a), b(vectors.bPub), utf8Encode(vectors.session), utf8Encode(vectors.info))!;
    expect(toHex(key)).toBe(vectors.key);
    for (const m of vectors.messages) {
      expect(toHex(ck.seal(key, b(m.nonce), b(m.plain))!)).toBe(m.sealed);
      expect(toHex(ck.open(key, b(m.nonce), b(m.sealed))!)).toBe(m.plain);
    }
    const bad = b(vectors.messages[0].sealed);
    bad[0] ^= 1;
    expect(ck.open(key, b(vectors.messages[0].nonce), bad)).toBeNull();
  });

  it('a CryptoKit device and an @noble device talk to each other', () => {
    old = setCipherForTests(cryptoKitCipher(fakeNative()));
    let i = 1;
    const random = (n: number) => Uint8Array.from({ length: n }, () => (i = (i * 33 + 7) & 0xff));
    const ios = generateKeyPair(random);
    const kIos = deriveKey(ios.priv, toBase64Url(noble.publicKey(b(vectors.b))!), vectors.session)!;
    const box = seal(kIos, { t: 'join', name: 'Sam' }, random);
    setCipherForTests(noble);
    const kAndroid = deriveKey(b(vectors.b), ios.pub, vectors.session)!;
    expect(open(kAndroid, box)).toEqual({ t: 'join', name: 'Sam' });
  });

  it('gives null with no native module (an older build)', () => {
    const ck = cryptoKitCipher(null);
    expect(ck.publicKey(b(vectors.a))).toBeNull();
    expect(ck.seal(b(vectors.key), b(vectors.messages[0].nonce), new Uint8Array(1))).toBeNull();
    old = setCipherForTests(ck);
    expect(() => generateKeyPair((n) => new Uint8Array(n).fill(1))).toThrow();
  });
});
