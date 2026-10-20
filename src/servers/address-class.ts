/**
 * What kind of network an address belongs to. One shared classifier for the
 * local network help, the discovery and the address labels.
 *
 * - `lan`: the local network: the RFC 1918 ranges (10/8, 172.16/12 and the
 *   /16 block of home routers), link-local 169.254/16, IPv6 unique-local and
 *   link-local addresses, names that end in a local suffix (`LOCAL_SUFFIX`:
 *   local, lan, home, localdomain, home.arpa and one more) and one-label names. iOS and macOS ask the
 *   user for local network access before the app can reach these.
 * - `tailscale`: Tailscale (100.64/10, the CGNAT range, `*.ts.net` names and
 *   fd7a:115c:a1e0::/48). This is a VPN, not the local network.
 * - `loopback`: this device.
 * - `public`: everything else, also names that DNS resolves.
 */
import { isPrivateIPv4, parseIPv4 } from './discovery/subnet';

export type AddressClass = 'lan' | 'tailscale' | 'loopback' | 'public';

/** Name suffixes that home routers and local DNS use. */
const LOCAL_SUFFIX = /\.(local|lan|home|internal|localdomain|home\.arpa)$/;

/** The host of a URL or of a bare `host:port`, in lower case. Brackets of an IPv6 address are removed. */
export function hostOf(urlOrHost: string): string {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(urlOrHost.trim());
  return (m?.[1] ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/** True for 100.64.0.0/10, the range Tailscale gives its devices. */
export function isTailscaleIPv4(n: number): boolean {
  return n >>> 22 === (100 << 2) + 1;
}

export function classifyAddress(urlOrHost: string): AddressClass {
  const host = hostOf(urlOrHost);
  if (!host) return 'public';
  if (host === 'localhost' || host === '::1') return 'loopback';
  if (host.endsWith('.ts.net')) return 'tailscale';
  if (LOCAL_SUFFIX.test(host)) return 'lan';
  const n = parseIPv4(host);
  if (n !== null) {
    if (n >>> 24 === 127) return 'loopback';
    if (isTailscaleIPv4(n)) return 'tailscale';
    return isPrivateIPv4(n) ? 'lan' : 'public';
  }
  if (host.includes(':')) {
    if (/^fd7a:115c:a1e0:/.test(host)) return 'tailscale';
    if (/^(fe8|fe9|fea|feb|fc|fd)/.test(host)) return 'lan';
    return 'public';
  }
  if (!host.includes('.')) return 'lan';
  return 'public';
}

/** True for an address in 10.0.0.0/8, the range WireGuard setups often use. */
export function isTenNet(urlOrHost: string): boolean {
  const n = parseIPv4(hostOf(urlOrHost));
  return n !== null && n >>> 24 === 10;
}

/** Interface names of VPN tunnels: utun (Apple), tun, wg (WireGuard), ppp, ipsec, tailscale. */
const VPN_INTERFACE = /^(utun|tun|wg|ppp|ipsec|tailscale)\d*/i;

/**
 * True when an interface with an IPv4 address is a VPN tunnel. Apple devices
 * always have some utun interfaces for system services, but those have only
 * IPv6 addresses, so an IPv4 address on a tunnel means a VPN is up.
 */
export function hasVpnInterface(interfaces: readonly { name?: string; address: string }[]): boolean {
  return interfaces.some((i) => !!i.name && VPN_INTERFACE.test(i.name) && parseIPv4(i.address) !== null);
}
