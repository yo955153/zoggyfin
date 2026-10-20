/**
 * Help for the nearby session sheet, so that a user always knows why a list
 * is empty and what to do. Pure logic and copy, no React.
 *
 * Product facts that the copy must keep:
 * - Apple devices (iPhone, iPad, the Mac app) connect directly, with no Wi-Fi network.
 * - Android needs a shared Wi-Fi or a hotspot.
 * - An iPhone with no mobile data (for example in airplane mode) cannot turn
 *   on Personal Hotspot, and iOS apps cannot make a Wi-Fi network. So with no
 *   Wi-Fi, the Android device makes the network, as host or as guest.
 * - Bluetooth finds nearby devices and lets the Android phone make the
 *   hotspot by itself.
 */
import type { BleState } from './link-native-types';

export type HelpPlatform = 'ios' | 'android' | 'mac';

export interface NetworkInfo {
  type: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown' | 'other';
  ssid: string | null;
}

export interface VisibleToInput {
  platform: HelpPlatform;
  network: NetworkInfo | null;
  ble: BleState | null;
  hotspot: { ssid: string } | null;
}

const isApple = (p: HelpPlatform) => p === 'ios' || p === 'mac';

/** The host's "Visible to" lines: who can find this session now. */
export function visibleTo(input: VisibleToInput): string[] {
  const { platform, network, ble, hotspot } = input;
  const apple = isApple(platform);
  const lines: string[] = [];
  if (apple) lines.push('Apple devices nearby (direct)');

  const wifi = network?.type === 'wifi';
  const ethernet = network?.type === 'ethernet';
  if (wifi) lines.push(network?.ssid ? `Devices on the Wi-Fi “${network.ssid}”` : 'Devices on this Wi-Fi');
  else if (ethernet) lines.push('Devices on this network');

  if (hotspot) lines.push(`Devices that join the Wi-Fi “${hotspot.ssid}”`);

  const bleOn = ble === 'on';
  if (bleOn) lines.push(apple ? 'Android devices nearby over Bluetooth' : 'Phones and tablets nearby over Bluetooth');

  if (!wifi && !ethernet && !hotspot && !bleOn) {
    lines.push(
      apple ? 'No Wi-Fi: Android devices cannot find this session' : 'No Wi-Fi: nobody can find this session. Make a hotspot.',
    );
  }
  return lines;
}

export type HelpItem =
  | { id: 'local-network-denied'; action: 'open-settings' }
  | { id: 'bluetooth-off'; action: 'open-settings' }
  | { id: 'bluetooth-denied'; action: 'ask-permission' }
  | { id: 'same-wifi' }
  | { id: 'apple-direct' }
  /** `make-hotspot`: this Android device can make the network. `null`: text only (an Apple device). */
  | { id: 'android-hotspot'; action: 'make-hotspot' | null }
  | { id: 'personal-hotspot' }
  | { id: 'isolated-wifi' }
  | { id: 'scan-code'; action: 'scan-code' }
  | { id: 'type-code'; action: 'type-code' };

export type HelpAction = 'open-settings' | 'ask-permission' | 'make-hotspot' | 'scan-code' | 'type-code';

export interface GuestHelpInput {
  platform: HelpPlatform;
  /** Time since the search started, ms. */
  elapsedMs: number;
  /** The number of sessions found. */
  found: number;
  network: NetworkInfo | null;
  localNetwork: 'denied' | 'ok' | 'unknown';
  ble: BleState | null;
  /** Android 8+: this device can make a local-only hotspot. */
  canMakeHotspot: boolean;
  hasMobileData: boolean;
}

/** The guest waits this long with nothing found before the help card shows. */
export const HELP_DELAY_MS = 8000;

/**
 * The guest's help card. It shows when nothing is found after 8 seconds,
 * or at once when local network access is denied. The order is: permission
 * problems, then network items, then the code items.
 */
export function guestHelp(input: GuestHelpInput): { show: boolean; items: HelpItem[] } {
  const { platform, network, ble } = input;
  const denied = input.localNetwork === 'denied';
  const show = denied || (input.found === 0 && input.elapsedMs >= HELP_DELAY_MS);
  if (!show) return { show: false, items: [] };

  const apple = isApple(platform);
  const wifi = network?.type === 'wifi';
  const onLan = wifi || network?.type === 'ethernet';
  const items: HelpItem[] = [];

  // Permission problems.
  if (denied) items.push({ id: 'local-network-denied', action: 'open-settings' });
  if (ble === 'off') items.push({ id: 'bluetooth-off', action: 'open-settings' });
  else if (ble === 'unauthorized') items.push({ id: 'bluetooth-denied', action: 'ask-permission' });

  // Network.
  items.push({ id: 'same-wifi' });
  if (apple) items.push({ id: 'apple-direct' });
  if (!onLan) {
    if (apple) items.push({ id: 'android-hotspot', action: null });
    else if (input.canMakeHotspot) items.push({ id: 'android-hotspot', action: 'make-hotspot' });
  }
  if (platform === 'ios' && input.hasMobileData) items.push({ id: 'personal-hotspot' });
  if (wifi) items.push({ id: 'isolated-wifi' });

  // Codes.
  items.push({ id: 'scan-code', action: 'scan-code' }, { id: 'type-code', action: 'type-code' });
  return { show: true, items };
}

export interface HelpCopy {
  title: string;
  detail: string;
  action?: { id: HelpAction; label: string };
}

/** The short text of a help item. */
export function helpCopy(item: HelpItem): HelpCopy {
  switch (item.id) {
    case 'local-network-denied':
      return {
        title: 'Allow local network access',
        detail: 'Zoggyfin cannot find devices on this network. Turn on Local Network for Zoggyfin in Settings.',
        action: { id: 'open-settings', label: 'Open Settings' },
      };
    case 'bluetooth-off':
      return {
        title: 'Turn on Bluetooth',
        detail: 'Bluetooth finds nearby devices with no shared Wi-Fi. Turn it on in Settings.',
        action: { id: 'open-settings', label: 'Open Settings' },
      };
    case 'bluetooth-denied':
      return {
        title: 'Allow Bluetooth',
        detail: 'Bluetooth finds nearby devices with no shared Wi-Fi. Zoggyfin needs your permission to use it.',
        action: { id: 'ask-permission', label: 'Allow Bluetooth' },
      };
    case 'same-wifi':
      return {
        title: 'Use the same Wi-Fi',
        detail: 'Connect this device and the host to the same Wi-Fi network.',
      };
    case 'apple-direct':
      return {
        title: 'Apple devices connect directly',
        detail: 'An iPhone, iPad or Mac host connects with no Wi-Fi network. Keep Wi-Fi and Bluetooth on, and stay near the host.',
      };
    case 'android-hotspot':
      return item.action === 'make-hotspot'
        ? {
            title: 'Make a hotspot',
            detail: 'With no Wi-Fi, this phone can make a Wi-Fi network. The host joins it, then you can join the session.',
            action: { id: 'make-hotspot', label: 'Make a hotspot' },
          }
        : {
            title: 'No Wi-Fi with an Android device',
            detail: 'The Android device makes the Wi-Fi network, as host or as guest. Then this device joins that network.',
          };
    case 'personal-hotspot':
      return {
        title: 'Personal Hotspot',
        detail: 'If your iPhone has mobile data, Personal Hotspot also works. The other device joins it.',
      };
    case 'isolated-wifi':
      return {
        title: 'Some Wi-Fi blocks devices',
        detail:
          'Some Wi-Fi networks, for example in hotels and on planes, do not let devices see each other. Use the code from the host.',
      };
    case 'scan-code':
      return {
        title: 'Scan the host’s code',
        detail: 'On the host, open the session and show the code. Scan it with this device.',
        action: { id: 'scan-code', label: 'Scan code' },
      };
    case 'type-code':
      return {
        title: 'Type the host’s code',
        detail: 'Type the short code that the host shows under the QR code.',
        action: { id: 'type-code', label: 'Type code' },
      };
  }
}
