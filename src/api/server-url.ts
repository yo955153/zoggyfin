/**
 * Helpers for the server address that the user types in.
 */

/**
 * Returns the candidate base URLs to try for what the user typed, most likely first.
 * Returns an empty list when the input cannot be a URL.
 */
export function serverUrlCandidates(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  if (/\s/.test(text)) return [];

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return [];

  const schemes = hasScheme ? [''] : ['https://', 'http://'];
  const out: string[] = [];
  for (const scheme of schemes) {
    const normalized = normalizeServerUrl(scheme + text);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Normalizes a full server URL: lower-case scheme and host, no trailing slash,
 * no `/web` suffix (users often paste the web client address), no query or hash.
 * Returns null when the URL is not valid.
 */
export function normalizeServerUrl(url: string): string | null {
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(url.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const host = match[2].toLowerCase();
  if (!/^[a-z0-9.\-[\]:]+$/i.test(host) || host.startsWith(':')) return null;

  let path = match[3].replace(/\/+$/, '');
  path = path.replace(/\/web(\/index\.html)?$/i, '');
  path = path.replace(/\/+$/, '');
  return `${scheme}://${host}${path}`;
}
