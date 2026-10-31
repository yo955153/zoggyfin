/**
 * How the app reads from a provider. Native fetches with the provider's
 * user agent and streams large files from the disk; the Mac app fetches in
 * Rust (no CORS); the plain web fetches directly and says when the browser
 * blocks it. Errors are `IptvError`s and never hold the URL.
 */
export interface FetchOptions {
  userAgent: string | null;
  /** The most bytes to read (after inflating gzip). */
  maxBytes: number;
}

export interface IptvTransport {
  /** The text of a URL in chunks (gzip inflated). */
  text(url: string, opts: FetchOptions): AsyncIterable<string>;
  /** A JSON answer. */
  json(url: string, opts: FetchOptions): Promise<unknown>;
  /** True when this platform can send a user agent of its own (not a browser). */
  readonly sendsUserAgent: boolean;
}

/** Lists and guides: at most this much text. */
export const MAX_LIST_BYTES = 400 * 1024 * 1024;
/** JSON answers (an Xtream stream list can be 20 MB). */
export const MAX_JSON_BYTES = 80 * 1024 * 1024;
/** How long a request may wait for an answer, ms. */
export const REQUEST_TIMEOUT_MS = 30_000;
