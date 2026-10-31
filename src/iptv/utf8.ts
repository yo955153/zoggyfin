/**
 * UTF-8 to text in chunks, and base64 text. Hermes has no TextDecoder and no
 * dependable atob, so the app decodes itself; where TextDecoder exists (web,
 * the Mac app, Jest) it is used. A sequence split over two chunks is kept for
 * the next chunk. Bad bytes become U+FFFD. Pure, so it is unit-tested.
 */

const REPLACEMENT = 0xfffd;
/** String.fromCharCode.apply takes at most about this many arguments safely. */
const SLICE = 8192;

interface NativeDecoder {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}

function nativeDecoder(): NativeDecoder | null {
  const TD = (globalThis as { TextDecoder?: new (label?: string) => NativeDecoder }).TextDecoder;
  if (typeof TD !== 'function') return null;
  try {
    return new TD('utf-8');
  } catch {
    return null;
  }
}

function codeUnitsToString(units: Uint16Array, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += SLICE) {
    out += String.fromCharCode.apply(null, Array.from(units.subarray(i, Math.min(length, i + SLICE))));
  }
  return out;
}

/** The length of a sequence that starts with this byte, or 0 for a byte that cannot start one. */
function sequenceLength(b: number): number {
  if (b < 0x80) return 1;
  if (b >= 0xc2 && b <= 0xdf) return 2;
  if (b >= 0xe0 && b <= 0xef) return 3;
  if (b >= 0xf0 && b <= 0xf4) return 4;
  return 0;
}

/** Decodes UTF-8 in JS. `pending` holds the bytes of an unfinished sequence from the last chunk. */
export class Utf8Decoder {
  private pending: number[] = [];
  private readonly native: NativeDecoder | null;

  /** `useNative: false` forces the JS decoder (tests compare the two). */
  constructor(opts: { useNative?: boolean } = {}) {
    this.native = opts.useNative === false ? null : nativeDecoder();
  }

  /** Decodes a chunk. `final` flushes an unfinished sequence as U+FFFD. */
  decode(chunk: Uint8Array, final = false): string {
    if (this.native) return this.native.decode(chunk, { stream: !final });
    let bytes = chunk;
    if (this.pending.length) {
      const joined = new Uint8Array(this.pending.length + chunk.length);
      joined.set(this.pending);
      joined.set(chunk, this.pending.length);
      bytes = joined;
      this.pending = [];
    }
    const units = new Uint16Array(bytes.length + 1);
    let n = 0;
    let i = 0;
    const len = bytes.length;
    while (i < len) {
      const b = bytes[i];
      if (b < 0x80) {
        units[n++] = b;
        i++;
        continue;
      }
      const need = sequenceLength(b);
      if (need === 0) {
        units[n++] = REPLACEMENT;
        i++;
        continue;
      }
      // Count the valid continuation bytes (the second byte has a narrower range for some lead bytes).
      let k = 0;
      while (k < need - 1 && i + 1 + k < len) {
        const cb = bytes[i + 1 + k];
        let lo = 0x80;
        let hi = 0xbf;
        if (k === 0) {
          if (b === 0xe0) lo = 0xa0;
          else if (b === 0xed) hi = 0x9f;
          else if (b === 0xf0) lo = 0x90;
          else if (b === 0xf4) hi = 0x8f;
        }
        if (cb < lo || cb > hi) break;
        k++;
      }
      if (k < need - 1) {
        if (i + 1 + k >= len && !final) {
          // Split over chunks: keep the start for the next chunk.
          for (let x = i; x < len; x++) this.pending.push(bytes[x]);
          break;
        }
        // One U+FFFD for the longest valid start of a sequence (as TextDecoder does).
        units[n++] = REPLACEMENT;
        i += 1 + k;
        continue;
      }
      let cp: number;
      if (need === 2) cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      else if (need === 3) cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      else cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += need;
      if (cp >= 0x10000) {
        if (n + 2 > units.length) break;
        cp -= 0x10000;
        units[n++] = 0xd800 + (cp >> 10);
        units[n++] = 0xdc00 + (cp & 0x3ff);
      } else {
        units[n++] = cp;
      }
    }
    return codeUnitsToString(units, n);
  }
}

/** Decodes one whole buffer. */
export function decodeUtf8(bytes: Uint8Array): string {
  return new Utf8Decoder().decode(bytes, true);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i;
B64_INDEX['-'] = 62;
B64_INDEX._ = 63;

/** The bytes of base64 (standard or URL-safe; padding and spaces are ignored). Null when it is not base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=]/g, '');
  if (clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let n = 0;
  for (const ch of clean) {
    const v = B64_INDEX[ch];
    if (v === undefined) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/** Base64 text as a string (Xtream sends guide titles this way). The input itself when it is not base64. */
export function decodeBase64Text(text: string): string {
  const bytes = base64ToBytes(text);
  if (!bytes) return text;
  const out = decodeUtf8(bytes);
  // Plain text that only looks like base64 ("News") decodes to bytes that are not text.
  return /[\ufffd\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(out) ? text : out;
}
