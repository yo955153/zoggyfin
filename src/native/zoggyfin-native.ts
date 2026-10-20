import { invoke, isDesktop } from '@/platform/desktop';

/** Web: no native module. The web player probes the browser instead. */
export function isHardwareDecodeSupported(_codec: 'av1' | 'hevc' | 'h264' | 'vp9'): boolean {
  return false;
}

export function excludeFromBackup(_path: string): boolean {
  return false;
}

export const hasNativeKeyInput = false;

export function androidDecoders(): null {
  return null;
}

export function setAutoPictureInPicture(_enabled: boolean): void {}

/**
 * The Mac app: rewrites a fragmented MP4 download as a plain MP4 (the
 * AVFoundation step of iOS, through the Swift library of the nearby bridge).
 * A browser: "skipped".
 */
export async function makeSeekableMp4(path: string): Promise<'done' | 'skipped' | 'failed'> {
  const mac = isDesktop && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
  if (!mac) return 'skipped';
  try {
    const r = await invoke<string>('nearby_call', { cmd: 'makeSeekableMp4', args: [path] });
    return r === 'done' || r === 'failed' ? r : 'skipped';
  } catch {
    return 'failed';
  }
}
