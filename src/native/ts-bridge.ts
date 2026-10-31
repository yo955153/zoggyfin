/**
 * The TS bridge on the web and in the Mac app: none. The web player
 * (hls.js) and libmpv do not need it. See `ts-bridge-types.ts`.
 */
import type { TsBridge } from './ts-bridge-types';

export const tsBridge: TsBridge | null = null;
