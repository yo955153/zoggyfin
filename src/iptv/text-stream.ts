/**
 * Byte chunks to text chunks: gzip (a `.xml.gz` guide) is found by its magic
 * bytes and inflated as it streams (fflate: Hermes has no
 * DecompressionStream), then UTF-8 is decoded. Between chunks the event loop
 * gets a turn, so a 100 MB guide never blocks the UI and is never one string.
 * Pure (no React, no native code), so it is unit-tested.
 */
import { Gunzip } from 'fflate';

import { Utf8Decoder } from './utf8';

/** Lets the event loop run (touches, renders) between chunks. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** True when the bytes start with the gzip magic number. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Splits one buffer into chunks (for sources that give the whole body at once). */
export async function* chunksOf(bytes: Uint8Array, size = 512 * 1024): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, Math.min(bytes.length, i + size));
}

/** The text of a byte stream, chunk by chunk. A size cap (bytes after inflating) stops runaway files. */
export async function* textChunks(source: AsyncIterable<Uint8Array>, opts: { maxBytes?: number } = {}): AsyncGenerator<string> {
  const max = opts.maxBytes ?? Number.POSITIVE_INFINITY;
  const decoder = new Utf8Decoder();
  let gunzip: Gunzip | null = null;
  let started = false;
  let total = 0;
  let out: Uint8Array[] = [];
  const take = (): Uint8Array[] => {
    const list = out;
    out = [];
    return list;
  };
  for await (const chunk of source) {
    if (!chunk.length) continue;
    if (!started) {
      started = true;
      if (isGzip(chunk)) {
        gunzip = new Gunzip((data) => {
          out.push(data);
        });
      }
    }
    if (gunzip) gunzip.push(chunk, false);
    else out.push(chunk);
    for (const piece of take()) {
      total += piece.length;
      if (total > max) throw new Error('too large');
      const text = decoder.decode(piece);
      if (text) yield text;
    }
    await yieldToEventLoop();
  }
  if (gunzip) gunzip.push(new Uint8Array(0), true);
  const rest = take();
  for (let i = 0; i < rest.length; i++) {
    total += rest[i].length;
    if (total > max) throw new Error('too large');
    const text = decoder.decode(rest[i], i === rest.length - 1);
    if (text) yield text;
  }
  if (!rest.length) {
    const tail = decoder.decode(new Uint8Array(0), true);
    if (tail) yield tail;
  }
}
