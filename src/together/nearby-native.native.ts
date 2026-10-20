/**
 * The nearby native module on iOS, iPadOS and Android (modules/zoggyfin-native,
 * `ZoggyfinTogether`): the transport of `link-native-types.ts`. Optional: a
 * build without it (an older build that gets this code over the air, or a
 * build with the old Multipeer module) has `linkNative === null`, and nearby
 * mode stays hidden.
 */
import { type EventSubscription, requireOptionalNativeModule } from 'expo';

import type { LinkEvents, NearbyLinkNative } from './link-native-types';
import type { NearbyNative } from './nearby-native-types';

type Module = Omit<NearbyLinkNative, 'on'> & {
  addListener<K extends keyof LinkEvents>(name: K, listener: LinkEvents[K]): EventSubscription;
};

const mod = requireOptionalNativeModule<Module>('ZoggyfinTogether');

/** The old Multipeer API is gone. */
export const nearbyNative: NearbyNative | null = null;

function wrap(m: Module): NearbyLinkNative {
  const opt = <K extends keyof NearbyLinkNative>(k: K) => (typeof m[k as keyof Module] === 'function' ? (m[k as keyof Module] as NearbyLinkNative[K]) : undefined);
  return {
    platform: m.platform === 'android' ? 'android' : 'apple',
    monotonicNow: () => m.monotonicNow(),
    randomBytes: (n) => m.randomBytes(n),
    startServer: (name, txt) => m.startServer(name, txt),
    stopAdvertising: () => m.stopAdvertising(),
    shareFile: (path, file, mime) => m.shareFile(path, file, mime),
    setPace: opt('setPace')?.bind(m),
    unshareAll: () => m.unshareAll(),
    stopServer: () => m.stopServer(),
    startBrowsing: () => m.startBrowsing(),
    stopBrowsing: () => m.stopBrowsing(),
    connect: (id) => m.connect(id),
    connectAddress: (host, port) => m.connectAddress(host, port),
    mediaBase: (id, host, port) => m.mediaBase(id, host, port),
    stopRelay: () => m.stopRelay(),
    send: (id, text) => m.send(id, text),
    close: (id) => m.close(id),
    addresses: () => m.addresses(),
    stopAll: () => m.stopAll(),
    mediaStats: () => m.mediaStats(),
    startHotspot: opt('startHotspot')?.bind(m),
    stopHotspot: opt('stopHotspot')?.bind(m),
    bleState: opt('bleState')?.bind(m),
    bleRequestPermission: opt('bleRequestPermission')?.bind(m),
    bleAdvertise: opt('bleAdvertise')?.bind(m),
    bleStopAdvertising: opt('bleStopAdvertising')?.bind(m),
    bleScan: opt('bleScan')?.bind(m),
    bleStopScan: opt('bleStopScan')?.bind(m),
    bleSend: opt('bleSend')?.bind(m),
    bleDisconnect: opt('bleDisconnect')?.bind(m),
    bleStopAll: opt('bleStopAll')?.bind(m),
    joinWifi: opt('joinWifi')?.bind(m),
    leaveWifi: opt('leaveWifi')?.bind(m),
    openSettings: opt('openSettings')?.bind(m),
    on: (name, listener) => m.addListener(name, listener),
  };
}

export const linkNative: NearbyLinkNative | null = mod && typeof mod.startServer === 'function' ? wrap(mod) : null;
