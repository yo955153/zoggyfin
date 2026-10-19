/** A Jellyfin server found on the local network. */
export interface DiscoveredServer {
  /** The server Id, as the server writes it. */
  id: string;
  name: string;
  /** Null until the server tells it (a UDP answer has no version). */
  version: string | null;
  /** The base URL to connect to, with no trailing slash. */
  address: string;
  /** How the app found it. A UDP answer gives the address the server prefers. */
  source: 'udp' | 'scan';
}
