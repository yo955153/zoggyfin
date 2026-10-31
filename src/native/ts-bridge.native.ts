/**
 * The TS bridge on iOS (modules/zoggyfin-native, `ZoggyfinTsBridge`): plays a
 * progressive MPEG-TS stream as a local HLS playlist. The contract and the
 * rule for when to use it are in `ts-bridge-types.ts`.
 *
 * Optional: Android has no such module, and an iOS binary built before the
 * bridge gets this code over the air with no module. In both cases
 * `tsBridge` is null.
 */
import { type EventSubscription, requireOptionalNativeModule } from 'expo';

import { type TsBridge, type TsBridgeCode, TsBridgeError, type TsBridgeStartOptions, type TsBridgeStatus } from './ts-bridge-types';

type StartReply = { ok: true; id: string; playlistUrl: string } | { ok: false; code: TsBridgeCode; message: string; httpStatus?: number };

interface Module {
  start(url: string, headers: Record<string, string>, options: TsBridgeStartOptions): Promise<StartReply>;
  stop(id: string): Promise<void>;
  stopAll(): Promise<void>;
  addListener(name: 'onStatus', listener: (status: TsBridgeStatus) => void): EventSubscription;
}

const mod = requireOptionalNativeModule<Module>('ZoggyfinTsBridge');

function wrap(m: Module): TsBridge {
  return {
    async start(url, headers = {}, options = {}) {
      const r = await m.start(url, headers, options);
      if (!r.ok) throw new TsBridgeError(r.code, r.message, r.httpStatus);
      return { id: r.id, playlistUrl: r.playlistUrl };
    },
    stop: (id) => m.stop(id),
    stopAll: () => m.stopAll(),
    addStatusListener(listener) {
      const sub = m.addListener('onStatus', listener);
      return () => sub.remove();
    },
  };
}

export const tsBridge: TsBridge | null = mod ? wrap(mod) : null;
