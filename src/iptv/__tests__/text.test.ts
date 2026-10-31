import { gzipSync } from 'fflate';

import { chunksOf, isGzip, textChunks } from '../text-stream';
import { toBase64 } from '../test-utils/fixtures';
import { base64ToBytes, decodeBase64Text, Utf8Decoder } from '../utf8';

const SAMPLE = 'Plain ASCII, é à ü, Ελληνικά, 日本語, emoji 😀🎬 and the end.';
const bytes = new TextEncoder().encode(SAMPLE);

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of it) out += t;
  return out;
}

describe('Utf8Decoder (JS)', () => {
  it('decodes any split of the bytes', () => {
    for (const size of [1, 2, 3, 5, 7, 64]) {
      const d = new Utf8Decoder({ useNative: false });
      let out = '';
      for (let i = 0; i < bytes.length; i += size) out += d.decode(bytes.subarray(i, i + size));
      out += d.decode(new Uint8Array(0), true);
      expect(out).toBe(SAMPLE);
    }
  });

  it('replaces bad bytes like TextDecoder', () => {
    const bad = new Uint8Array([0x41, 0xff, 0x42, 0xc3, 0x28, 0xe2, 0x82, 0x43]);
    const js = new Utf8Decoder({ useNative: false }).decode(bad, true);
    expect(js).toBe(new TextDecoder().decode(bad));
  });

  it('flushes an unfinished sequence at the end', () => {
    const d = new Utf8Decoder({ useNative: false });
    expect(d.decode(new Uint8Array([0x41, 0xe2, 0x82]))).toBe('A');
    expect(d.decode(new Uint8Array(0), true)).toBe('�');
  });

  it('decodes 8 MB fast', () => {
    const big = new TextEncoder().encode('#EXTINF:-1 tvg-name="Channel é",Channel é\nhttp://example.com/1.ts\n'.repeat(120_000));
    const t0 = Date.now();
    const text = new Utf8Decoder({ useNative: false }).decode(big, true);
    expect(text.length).toBeGreaterThan(7_000_000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('base64', () => {
  it('decodes standard and URL-safe base64', () => {
    expect(decodeBase64Text('VG9tICYgSmVycnk=')).toBe('Tom & Jerry');
    expect(decodeBase64Text(toBase64('Nachrichten über alles'))).toBe('Nachrichten über alles');
    expect(base64ToBytes('-_8')).toEqual(new Uint8Array([0xfb, 0xff]));
  });
  it('leaves plain text as it is', () => {
    expect(decodeBase64Text('News at 6')).toBe('News at 6');
    expect(decodeBase64Text('News')).toBe('News');
  });
});

describe('textChunks', () => {
  it('passes plain bytes through', async () => {
    expect(await collect(textChunks(chunksOf(bytes, 3)))).toBe(SAMPLE);
  });

  it('inflates gzip found by its magic bytes', async () => {
    const gz = gzipSync(bytes);
    expect(isGzip(gz)).toBe(true);
    expect(await collect(textChunks(chunksOf(gz, 5)))).toBe(SAMPLE);
  });

  it('stops at the size cap', async () => {
    await expect(collect(textChunks(chunksOf(bytes, 10), { maxBytes: 20 }))).rejects.toThrow('too large');
  });
});
