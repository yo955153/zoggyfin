/**
 * The M3U playlist parser. It takes the text in chunks (a line split over two
 * chunks is kept for the next one), so a 50 000-entry list is never held as
 * lines twice. Knows the `#EXTM3U` header (`url-tvg`, `x-tvg-url`), `#EXTINF`
 * attributes (`tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno`,
 * `catchup-days`) with double, single or no quotes, `#EXTGRP` and
 * `#EXTVLCOPT:http-user-agent`. A BOM and CRLF line ends are fine.
 * Pure, so it is unit-tested.
 */
import type { Channel } from './types';

export interface M3uResult {
  channels: Channel[];
  /** Guide URLs that the header names, in order. */
  guideUrls: string[];
  /** The user agent of the header, if any. */
  userAgent: string | null;
}

interface Pending {
  name: string;
  attrs: Record<string, string>;
  group: string | null;
  userAgent: string | null;
}

/** FNV-1a, 32 bits, as base 36: a short id that stays the same for the same text. */
export function hashId(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Reads `key="value"`, `key='value'` and `key=value` pairs. Keys are lower case. */
export function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9_:.-]+)\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s"']*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Splits `#EXTINF:` text into the attribute part and the name (after the first comma outside quotes). */
export function splitExtinf(body: string): { attrs: string; name: string } {
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      // A quote that opens a value (after `=`), not an apostrophe in a word.
      if (i > 0 && /[=\s]/.test(body[i - 1])) quote = ch;
    } else if (ch === ',') {
      return { attrs: body.slice(0, i), name: body.slice(i + 1).trim() };
    }
  }
  // An unclosed quote: fall back to the last comma.
  const last = body.lastIndexOf(',');
  return last >= 0 ? { attrs: body.slice(0, last), name: body.slice(last + 1).trim() } : { attrs: body, name: '' };
}

function toNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function nameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  const last = path.split('/').filter(Boolean).pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Incremental M3U parser: `push` text chunks, then `end`. */
export class M3uParser {
  private carry = '';
  private first = true;
  private pending: Pending | null = null;
  private loose: { group: string | null; userAgent: string | null } = { group: null, userAgent: null };
  private ids = new Map<string, number>();
  private readonly max: number;
  readonly channels: Channel[] = [];
  readonly guideUrls: string[] = [];
  userAgent: string | null = null;
  /** True once the first line was `#EXTM3U` (or an `#EXTINF`). */
  looksLikeM3u = false;

  constructor(opts: { maxChannels?: number } = {}) {
    this.max = opts.maxChannels ?? 200_000;
  }

  push(text: string): void {
    let data = this.carry + text;
    if (this.first && data.length) {
      if (data.charCodeAt(0) === 0xfeff) data = data.slice(1);
      this.first = false;
    }
    let start = 0;
    for (;;) {
      const nl = data.indexOf('\n', start);
      if (nl < 0) break;
      this.line(data.slice(start, nl));
      start = nl + 1;
    }
    this.carry = data.slice(start);
  }

  end(): M3uResult {
    if (this.carry) this.line(this.carry);
    this.carry = '';
    return { channels: this.channels, guideUrls: this.guideUrls, userAgent: this.userAgent };
  }

  private line(raw: string): void {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) return;
    if (line.startsWith('#')) {
      this.directive(line);
      return;
    }
    this.entry(line);
  }

  private directive(line: string): void {
    const upper = line.slice(0, 12).toUpperCase();
    if (upper.startsWith('#EXTM3U')) {
      this.looksLikeM3u = true;
      const a = parseAttributes(line.slice(7));
      for (const key of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
        for (const u of (a[key] ?? '').split(',')) {
          const url = u.trim();
          if (url && !this.guideUrls.includes(url)) this.guideUrls.push(url);
        }
      }
      this.userAgent = a['http-user-agent'] || a['user-agent'] || this.userAgent;
      return;
    }
    if (upper.startsWith('#EXTINF:')) {
      this.looksLikeM3u = true;
      const { attrs, name } = splitExtinf(line.slice(8));
      const a = parseAttributes(attrs);
      this.pending = { name: name || a['tvg-name'] || '', attrs: a, group: this.loose.group, userAgent: this.loose.userAgent };
      this.loose = { group: null, userAgent: null };
      return;
    }
    if (upper.startsWith('#EXTGRP:')) {
      const group = line.slice(8).trim();
      if (this.pending) this.pending.group = group;
      else this.loose.group = group;
      return;
    }
    if (upper.startsWith('#EXTVLCOPT:')) {
      const m = /^http-user-agent\s*=\s*(.+)$/i.exec(line.slice(11).trim());
      if (m) {
        const ua = m[1].trim().replace(/^["']|["']$/g, '');
        if (this.pending) this.pending.userAgent = ua;
        else this.loose.userAgent = ua;
      }
    }
  }

  private entry(url: string): void {
    const p = this.pending;
    this.pending = null;
    if (this.channels.length >= this.max) return;
    const a = p?.attrs ?? {};
    const name = (p?.name || a['tvg-name'] || nameFromUrl(url)).trim();
    const epgId = a['tvg-id'] || undefined;
    const base = hashId(`${name}|${epgId ?? ''}`);
    const seen = this.ids.get(base) ?? 0;
    this.ids.set(base, seen + 1);
    const ch: Channel = {
      id: seen ? `${base}-${seen}` : base,
      name,
      group: (a['group-title'] || p?.group || '').trim(),
      url,
    };
    if (a['tvg-logo'] || a.logo) ch.logo = a['tvg-logo'] || a.logo;
    const number = toNumber(a['tvg-chno'] ?? a['channel-number']);
    if (number !== undefined) ch.number = number;
    if (epgId) ch.epgId = epgId;
    const ua = p?.userAgent ?? this.loose.userAgent;
    if (ua) ch.userAgent = ua;
    const days = toNumber(a['catchup-days'] ?? a['tvg-rec'] ?? a.timeshift);
    if (days && (a.catchup || a['catchup-days'] || a['tvg-rec'] || a.timeshift)) ch.archiveDays = days;
    this.loose = { group: null, userAgent: null };
    this.channels.push(ch);
  }
}

/** Parses a whole playlist from text chunks; the event loop gets a turn between chunks (see text-stream.ts). */
export async function parseM3u(chunks: AsyncIterable<string>, opts: { maxChannels?: number } = {}): Promise<M3uResult & { looksLikeM3u: boolean }> {
  const p = new M3uParser(opts);
  for await (const text of chunks) p.push(text);
  return { ...p.end(), looksLikeM3u: p.looksLikeM3u };
}
