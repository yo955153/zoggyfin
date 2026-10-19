/**
 * The local native module (modules/zoggyfin-native). Optional: an older
 * development build without it falls back to safe answers.
 */
import { requireOptionalNativeModule } from 'expo';

interface ZoggyfinNativeModule {
  isHardwareDecodeSupported(codec: string): boolean;
  excludeFromBackup?(path: string): boolean;
}

const mod = requireOptionalNativeModule<ZoggyfinNativeModule>('ZoggyfinNative');

export function isHardwareDecodeSupported(codec: 'av1' | 'hevc' | 'h264' | 'vp9'): boolean {
  try {
    return mod?.isHardwareDecodeSupported(codec) ?? codec !== 'av1';
  } catch {
    return codec !== 'av1';
  }
}

/** Keeps a download folder out of device backups. False when the build has no support for it. */
export function excludeFromBackup(path: string): boolean {
  try {
    return mod?.excludeFromBackup?.(path) ?? false;
  } catch {
    return false;
  }
}

export const hasNativeKeyInput = mod !== null;
