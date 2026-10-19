import type { LanAccess } from './lan-access';
import type { FetchJson } from './scan';

/** An IPv4 address of the device with its prefix length (24 for 255.255.255.0) or netmask. */
export interface LocalInterface {
  /** The interface name (en0, wlan0, utun4, wg0), when the platform tells it. */
  name?: string;
  address: string;
  prefix?: number;
  netmask?: string;
}

/** What one platform gives the discovery: UDP, the local addresses and the access check. */
export interface DiscoveryBackend {
  /** False on the web: the first screen shows no discovery. */
  available: boolean;
  /** True when the platform asks the user for local network access (iOS, macOS). */
  asksLanAccess: boolean;
  /** True when `udp` sends the discovery broadcast. */
  udpSupported: boolean;
  /** The raw JSON answers to the discovery broadcast. `blocked` is true when the system refused the send. */
  udp(timeoutMs: number): Promise<{ answers: string[]; blocked: boolean }>;
  /** The local addresses to scan, best first (the active Wi-Fi or Ethernet first). */
  interfaces(): Promise<LocalInterface[]>;
  /**
   * Asks for local network access (this shows the system prompt the first
   * time) and tells the result. `timeoutMs` is how long to wait for the user.
   */
  lanAccess(timeoutMs: number): Promise<LanAccess>;
  /** True when a VPN tunnel is up (an IPv4 address on a tunnel interface, or Android's VPN network). */
  vpnActive(): Promise<boolean>;
  /** Opens the system settings where the user turns local network access on. */
  openSettings(): Promise<void>;
  fetchJson: FetchJson;
}
