import { type MediaCapabilities, webCapabilities } from './device-profile';

let cached: MediaCapabilities | null = null;

/** Browser capabilities, probed once. */
export function mediaCapabilities(): MediaCapabilities {
  if (cached) return cached;
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
