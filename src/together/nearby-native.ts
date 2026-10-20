/**
 * Web and desktop variant of the nearby module loader.
 *
 * - `linkNative`: the cross-platform transport (`link-native-types.ts`). In the
 *   macOS desktop app it is the Swift transport over Tauri (`link-desktop.ts`);
 *   in a browser it is null.
 * - `nearbyNative`: the old Multipeer module. The web has none (null).
 */
import { desktopLink } from './link-desktop';
import type { NearbyLinkNative } from './link-native-types';
import type { NearbyNative } from './nearby-native-types';

export const nearbyNative: NearbyNative | null = null;

export const linkNative: NearbyLinkNative | null = desktopLink;
