import type { NetworkSnapshot } from './wifi-rule';

/**
 * Where the Wi-Fi rule reads the network from. `available` is false on web
 * and on an app binary without the network module; the app then hides the
 * Wi-Fi rule and uses the probe only.
 */
export interface NetworkSource {
  available: boolean;
  /** The network now, or null when it cannot be read. */
  snapshot(): Promise<NetworkSnapshot | null>;
  /** Asks for the permission that the Wi-Fi name needs (location, while in use on iOS). True when granted. */
  requestPermission(): Promise<boolean>;
}
