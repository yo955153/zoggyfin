/**
 * The nearby native module (modules/zoggyfin-native, ZoggyfinTogetherModule):
 * Multipeer Connectivity, the media server and the guest relay. Optional: a
 * build without it (an older build that gets this code over the air) has
 * `nearbyNative === null`, and nearby mode stays hidden.
 */
import { type EventSubscription, requireOptionalNativeModule } from 'expo';

import type { NearbyEvents, NearbyNative } from './nearby-native-types';

interface Module extends NearbyNative {
  addListener<K extends keyof NearbyEvents>(name: K, listener: NearbyEvents[K]): EventSubscription;
}

const mod = requireOptionalNativeModule<Module>('ZoggyfinTogether');

export const nearbyNative: NearbyNative | null =
  mod && typeof mod.startHosting === 'function'
    ? {
        monotonicNow: () => mod.monotonicNow(),
        startHosting: (name, info) => mod.startHosting(name, info),
        startBrowsing: (name) => mod.startBrowsing(name),
        stopAdvertising: () => mod.stopAdvertising(),
        stopBrowsing: () => mod.stopBrowsing(),
        invite: (peerId, context) => mod.invite(peerId, context),
        respond: (inviteId, accept) => mod.respond(inviteId, accept),
        send: (text, peerIds, reliable) => mod.send(text, peerIds, reliable),
        stop: () => mod.stop(),
        startMediaServer: () => mod.startMediaServer(),
        shareFile: (urlPath, filePath, mime) => mod.shareFile(urlPath, filePath, mime),
        stopMediaServer: () => mod.stopMediaServer(),
        startRelay: (service) => mod.startRelay(service),
        stopRelay: () => mod.stopRelay(),
        mediaStats: () => mod.mediaStats(),
        on: (name, listener) => mod.addListener(name, listener),
      }
    : null;
