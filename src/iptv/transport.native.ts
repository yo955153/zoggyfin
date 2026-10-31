/**
 * Provider requests on iOS and Android. A list or guide downloads to a
 * temporary file first, then is read back in 512 KB pieces, so a 100 MB
 * guide is never one string in memory. JSON answers use fetch.
 */
import { File, FileMode, Paths } from 'expo-file-system';

import { randomId } from '@/lib/id';

import { IptvError } from './errors';
import { textChunks } from './text-stream';
import { type FetchOptions, type IptvTransport, REQUEST_TIMEOUT_MS } from './transport-types';

const PIECE = 512 * 1024;

function headers(opts: FetchOptions): Record<string, string> {
  return opts.userAgent ? { 'User-Agent': opts.userAgent } : {};
}

/** An error from the native download as an IptvError (its message can hold the URL: it is dropped). */
function downloadError(e: unknown): IptvError {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const m = /status (\d{3})|HTTP (\d{3})/i.exec(message);
  if (m) return new IptvError('http', Number(m[1] ?? m[2]));
  return new IptvError('network');
}

async function* fileBytes(file: File): AsyncGenerator<Uint8Array> {
  const handle = file.open(FileMode.ReadOnly);
  try {
    for (;;) {
      const bytes = await handle.readBytes(PIECE);
      if (!bytes.length) break;
      yield bytes;
    }
  } finally {
    handle.close();
  }
}

async function* downloadText(url: string, opts: FetchOptions): AsyncGenerator<string> {
  const file = new File(Paths.cache, `iptv-${randomId()}.tmp`);
  try {
    try {
      await File.downloadFileAsync(url, file, { headers: headers(opts), idempotent: true });
    } catch (e) {
      throw downloadError(e);
    }
    if ((file.size ?? 0) > opts.maxBytes) throw new IptvError('tooLarge');
    yield* textChunks(fileBytes(file), { maxBytes: opts.maxBytes });
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // The cache folder is emptied by the system too.
    }
  }
}

export const transport: IptvTransport = {
  sendsUserAgent: true,
  text: downloadText,
  async json(url, opts) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', ...headers(opts) }, signal: ctl.signal });
    } catch {
      throw new IptvError('network');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new IptvError('http', res.status);
    const text = await res.text();
    if (text.length > opts.maxBytes) throw new IptvError('tooLarge');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new IptvError('answer');
    }
  },
};
