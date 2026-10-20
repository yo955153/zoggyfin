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

export async function makeSeekableMp4(_path: string): Promise<'done' | 'skipped' | 'failed'> {
  return 'skipped';
}
