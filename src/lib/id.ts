/**
 * A random v4-style UUID that also works in a non-secure web context (plain
 * http), where `crypto.randomUUID` does not exist. `getRandomValues` works in
 * insecure contexts; Math.random is the last fallback.
 */
export function randomId(
  getRandomValues: ((buf: Uint8Array) => Uint8Array) | undefined = defaultGetRandomValues(),
): string {
  const bytes = new Uint8Array(16);
  if (getRandomValues) {
    getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultGetRandomValues(): ((buf: Uint8Array) => Uint8Array) | undefined {
  const c = (globalThis as { crypto?: { getRandomValues?: (buf: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === 'function') return (buf) => c.getRandomValues!(buf);
  return undefined;
}
