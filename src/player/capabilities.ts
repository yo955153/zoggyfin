import { hasMpv } from '@/platform/desktop';

import { type MediaCapabilities, mpvCapabilities, webCapabilities } from './device-profile';

let cached: MediaCapabilities | null = null;

/** Browser capabilities, probed once. In the desktop app: libmpv. */
export function mediaCapabilities(): MediaCapabilities {
  if (cached) return cached;
  if (hasMpv) {
    cached = mpvCapabilities();
    return cached;
  }
  const video = typeof document !== 'undefined' ? document.createElement('video') : null;
  const canPlay = (mime: string) => !!video && video.canPlayType(mime) !== '';
  const ms = (globalThis as { MediaSource?: { isTypeSupported(m: string): boolean } }).MediaSource;
  const canMse = (mime: string) => {
    try {
      return !!ms && ms.isTypeSupported(mime);
    } catch {
      return false;
    }
  };
  cached = webCapabilities({ canPlay, canMse, nativeHls: canPlay('application/vnd.apple.mpegurl') });
  return cached;
}
