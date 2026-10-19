import { Platform } from 'react-native';

import { androidDecoders, isHardwareDecodeSupported } from '@/native/zoggyfin-native';

import { appleCapabilities, exoCapabilities, type MediaCapabilities } from './device-profile';

let cached: MediaCapabilities | null = null;

/**
 * iOS: AVPlayer capabilities. AV1 only with a hardware decoder (A17 Pro, M3 and later).
 * Android: ExoPlayer capabilities from the decoders of the device.
 */
export function mediaCapabilities(): MediaCapabilities {
  if (cached) return cached;
  if (Platform.OS === 'android') {
    cached = exoCapabilities(androidDecoders());
    return cached;
  }
  cached = appleCapabilities({
    av1: isHardwareDecodeSupported('av1'),
    // Every supported iPhone and iPad decodes HEVC; the simulator may say no.
    hevc: isHardwareDecodeSupported('hevc'),
  });
  return cached;
}
