/**
 * The local native module (modules/zoggyfin-native). Optional: an older
 * development build without it falls back to safe answers.
 */
import { requireOptionalNativeModule } from 'expo';

interface ZoggyfinNativeModule {
  isHardwareDecodeSupported(codec: string): boolean;
}

const mod = requireOptionalNativeModule<ZoggyfinNativeModule>('ZoggyfinNative');

export function isHardwareDecodeSupported(codec: 'av1' | 'hevc' | 'h264' | 'vp9'): boolean {
  try {
    return mod?.isHardwareDecodeSupported(codec) ?? codec !== 'av1';
  } catch {
    return codec !== 'av1';
  }
}

export const hasNativeKeyInput = mod !== null;
