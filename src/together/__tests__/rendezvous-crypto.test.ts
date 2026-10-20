import {
  deriveKey,
  fromBase64Url,
  generateKeyPair,
  open,
  type Random,
  seal,
  toBase64Url,
  utf8Decode,
  utf8Encode,
  utf8Length,
} from '../rendezvous-crypto';

/** A seeded test source (xorshift32). Tests only: the app uses a native secure source. */
function seeded(seed: number): Random {
  let s = seed >>> 0 || 1;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      out[i] = s & 0xff;
    }
    return out;
  };
}

const SESSION = '1a2b3c4d';

describe('rendezvous crypto', () => {
  it('base64url round-trips and rejects bad text', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = seeded(n + 7)(n);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8');
    expect(fromBase64Url('a')).toBeNull();
    expect(fromBase64Url('ab+c')).toBeNull();
    expect(fromBase64Url('ab==')).toBeNull();
    expect(fromBase64Url('-_9')).toBeNull(); // not canonical: the last bits are not zero
    expect(fromBase64Url(42)).toBeNull();
  });

  it('UTF-8 encodes like TextEncoder and decodes strictly', () => {
    const s = 'Aé€😀ا';
    const bytes = utf8Encode(s);
    expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(s)));
    expect(utf8Length(s)).toBe(bytes.length);
    expect(utf8Decode(bytes)).toBe(s);
    expect(utf8Decode(Uint8Array.from([0xc3]))).toBeNull();
    expect(utf8Decode(Uint8Array.from([0xc0, 0x80]))).toBeNull(); // overlong
    expect(utf8Decode(Uint8Array.from([0xed, 0xa0, 0x80]))).toBeNull(); // surrogate
    expect(utf8Decode(Uint8Array.from([0xff]))).toBeNull();
  });

  it('both sides derive the same key; the session changes it', () => {
    const a = generateKeyPair(seeded(1));
    const b = generateKeyPair(seeded(2));
    expect(a.pub).toHaveLength(43);
    const ka = deriveKey(a.priv, b.pub, SESSION);
    const kb = deriveKey(b.priv, a.pub, SESSION);
    expect(ka).not.toBeNull();
    expect(ka).toHaveLength(32);
    expect(ka).toEqual(kb);
    expect(deriveKey(a.priv, b.pub, 'ffffffff')).not.toEqual(ka);
  });

  it('rejects bad public keys', () => {
    const a = generateKeyPair(seeded(1));
    expect(deriveKey(a.priv, 'nope', SESSION)).toBeNull();
    expect(deriveKey(a.priv, toBase64Url(new Uint8Array(31)), SESSION)).toBeNull();
    // The zero point gives a zero shared secret.
    expect(deriveKey(a.priv, toBase64Url(new Uint8Array(32)), SESSION)).toBeNull();
    expect(deriveKey(new Uint8Array(3), a.pub, SESSION)).toBeNull();
  });

  it('throws on a broken random source (a setup error)', () => {
    expect(() => generateKeyPair(() => new Uint8Array(3))).toThrow();
  });

  describe('seal / open', () => {
    const a = generateKeyPair(seeded(11));
    const b = generateKeyPair(seeded(12));
    const key = deriveKey(a.priv, b.pub, SESSION)!;
    const other = deriveKey(a.priv, generateKeyPair(seeded(13)).pub, SESSION)!;
    const value = { t: 'wifi', ssid: 'DIRECT-ab Zoggyfin', password: 'p@ss wörd 😀' };

    it('round-trips a JSON value', () => {
      const box = seal(key, value, seeded(99));
      expect(box).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(box).not.toContain('Zoggyfin');
      expect(open(key, box)).toEqual(value);
      expect(open(key, seal(key, [1, 'x', null], seeded(5)))).toEqual([1, 'x', null]);
    });

    it('uses a new nonce for each box', () => {
      const r = seeded(3);
      expect(seal(key, value, r)).not.toBe(seal(key, value, r));
    });

    it('gives null for a changed byte', () => {
      const bytes = fromBase64Url(seal(key, value, seeded(4)))!;
      for (const i of [0, 23, 24, 30, bytes.length - 1]) {
        const copy = Uint8Array.from(bytes);
        copy[i] ^= 0x01;
        expect(open(key, toBase64Url(copy))).toBeNull();
      }
    });

    it('gives null for a wrong key and for bad boxes', () => {
      const box = seal(key, value, seeded(4));
      expect(open(other, box)).toBeNull();
      expect(open(key, '***')).toBeNull();
      expect(open(key, '')).toBeNull();
      expect(open(key, box.slice(0, 20))).toBeNull();
      expect(open(key, 7)).toBeNull();
      expect(open(new Uint8Array(5), box)).toBeNull();
    });

    it('gives null for a sealed text that is not JSON', () => {
      // `seal` cannot make this box, so make it with the cipher directly.
      const { xchacha20poly1305 } = jest.requireActual('@noble/ciphers/chacha.js') as typeof import('@noble/ciphers/chacha.js');
      const nonce = new Uint8Array(24);
      const ct = xchacha20poly1305(key, nonce).encrypt(utf8Encode('{not json'));
      const box = new Uint8Array(24 + ct.length);
      box.set(nonce);
      box.set(ct, 24);
      expect(open(key, toBase64Url(box))).toBeNull();
    });

    it('gives an empty box for values that are not JSON and for a bad key', () => {
      expect(seal(key, undefined, seeded(1))).toBe('');
      const loop: Record<string, unknown> = {};
      loop.self = loop;
      expect(seal(key, loop, seeded(1))).toBe('');
      expect(seal(new Uint8Array(2), value, seeded(1))).toBe('');
      expect(seal(key, value, () => new Uint8Array(2))).toBe('');
    });
  });
});
