import { isHardwareDecodeSupported } from '@/native/zoggyfin-native';

import { appleCapabilities, type MediaCapabilities } from './device-profile';

let cached: MediaCapabilities | null = null;

/** AVPlayer capabilities. AV1 only with a hardware decoder (A17 Pro, M3 and later). */
export function mediaCapabilities(): MediaCapabilities {
  cached ??= appleCapabilities({
    av1: isHardwareDecodeSupported('av1'),
    // Every supported iPhone and iPad decodes HEVC; the simulator may say no.
    hevc: isHardwareDecodeSupported('hevc'),
  });
  return cached;
}
