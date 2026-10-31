/**
 * Provider requests on the web. The Mac app fetches through Rust
 * (`iptv_fetch` in desktop/src-tauri/src/iptv.rs): no CORS, and it sends the
 * provider's user agent. The plain web fetches directly: most providers send
 * no CORS headers, and a browser never lets a page set the user agent, so a
 * blocked request says that IPTV needs the app.
 */
import { iptvFetch, isDesktop } from '@/platform/desktop';

import { IptvError } from './errors';
import { chunksOf, textChunks } from './text-stream';
import { type FetchOptions, type IptvTransport, REQUEST_TIMEOUT_MS } from './transport-types';
import { decodeUtf8 } from './utf8';

/** A Rust error text as an IptvError (the Rust side never puts the URL in it). */
function desktopError(e: unknown): IptvError {
  const message = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  const m = /^HTTP (\d{3})/.exec(message);
  if (m) return new IptvError('http', Number(m[1]));
  if (/too large/i.test(message)) return new IptvError('tooLarge');
  if (/address/i.test(message)) return new IptvError('badAddress');
  return new IptvError('network');
}

async function desktopBytes(url: string, opts: FetchOptions): Promise<Uint8Array> {
  try {
    return await iptvFetch(url, opts.userAgent, opts.maxBytes);
  } catch (e) {
    throw desktopError(e);
  }
}

async function webResponse(url: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
  } catch {
    // CORS, mixed content (an http provider on an https page) or no connection: the browser does not say which.
    throw new IptvError('blocked');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new IptvError('http', res.status);
  return res;
}

async function* webBytes(url: string): AsyncGenerator<Uint8Array> {
  const res = await webResponse(url);
  const reader = res.body?.getReader();
  if (!reader) {
    yield new Uint8Array(await res.arrayBuffer());
    return;
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) yield value;
  }
}

async function* desktopText(url: string, opts: FetchOptions): AsyncGenerator<string> {
  const bytes = await desktopBytes(url, opts);
  yield* textChunks(chunksOf(bytes), { maxBytes: opts.maxBytes });
}

export const transport: IptvTransport = {
  sendsUserAgent: isDesktop,
  text(url, opts) {
    return isDesktop ? desktopText(url, opts) : textChunks(webBytes(url), { maxBytes: opts.maxBytes });
  },
  async json(url, opts) {
    const text = isDesktop ? decodeUtf8(await desktopBytes(url, opts)) : await (await webResponse(url)).text();
    if (text.length > opts.maxBytes) throw new IptvError('tooLarge');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new IptvError('answer');
    }
  },
};
