/** Web and other platforms: browsers do not tell the Wi-Fi name. Native builds use `network-source.native.ts`. */
import type { NetworkSource } from './network-source-types';

export type { NetworkSource } from './network-source-types';

export const networkSource: NetworkSource = {
  available: false,
  snapshot: async () => null,
  requestPermission: async () => false,
};
