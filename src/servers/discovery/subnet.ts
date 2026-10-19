/**
 * IPv4 math for the HTTP scan: the hosts of the device's own subnet.
 * The scan never covers more than a /22 (1022 hosts).
 */

/** The largest subnet the scan covers: a /22. */
export const MIN_PREFIX = 22;

/** An IPv4 address as an unsigned 32-bit number, or null when the text is not one. */
export function parseIPv4(text: string | null | undefined): number | null {
  if (!text) return null;
  const parts = text.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function formatIPv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/**
 * The prefix length of a netmask ("255.255.255.0" → 24). A number or "/24"
 * is a prefix already. Null when the mask is not contiguous or out of range.
 */
export function prefixOf(mask: string | number | null | undefined): number | null {
  if (mask === null || mask === undefined) return null;
  if (typeof mask === 'number') return Number.isInteger(mask) && mask >= 0 && mask <= 32 ? mask : null;
  const t = mask.trim().replace(/^\//, '');
  if (/^\d{1,2}$/.test(t)) return prefixOf(Number(t));
  const n = parseIPv4(t);
  if (n === null) return null;
  // A valid mask is ones then zeros: its inverse plus one is a power of two.
  const inv = ~n >>> 0;
  if ((inv & (inv + 1)) !== 0) return null;
  let bits = 0;
  for (let m = n; m & 0x80000000; m = (m << 1) >>> 0) bits++;
  return bits;
}

/** True for the private ranges a home server uses (the RFC 1918 ranges: 10/8, 172.16/12 and the /16 block of home routers) and link-local (169.254/16). */
export function isPrivateIPv4(n: number): boolean {
  return n >>> 24 === 10 || n >>> 20 === 0xac1 || n >>> 16 === 0xc0a8 || n >>> 16 === 0xa9fe;
}

export interface SubnetRange {
  /** The network address. */
  network: number;
  prefix: number;
  /** The directed broadcast address. */
  broadcast: number;
  /** The usable hosts, without the device itself. */
  hosts: string[];
}

/**
 * The hosts to scan on the subnet of `ip`/`mask`. A subnet larger than a /22
 * shrinks to the /22 around the device. Null for an invalid address or mask,
 * a /31 or /32, or an address that is not private (the app never scans a
 * public network).
 */
export function subnetHosts(ip: string | null | undefined, mask: string | number | null | undefined): SubnetRange | null {
  const addr = parseIPv4(ip);
  let prefix = prefixOf(mask);
  if (addr === null || prefix === null) return null;
  if (!isPrivateIPv4(addr)) return null;
  if (prefix > 30) return null;
  if (prefix < MIN_PREFIX) prefix = MIN_PREFIX;
  const size = 2 ** (32 - prefix);
  const network = addr - (addr % size);
  const broadcast = network + size - 1;
  const hosts: string[] = [];
  // Near hosts first: servers usually have addresses close to the device.
  for (let d = 1; d < size; d++) {
    for (const h of [addr - d, addr + d]) {
      if (h > network && h < broadcast) hosts.push(formatIPv4(h));
    }
  }
  return { network, prefix, broadcast, hosts };
}
