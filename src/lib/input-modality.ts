/**
 * Web: was the last input a key press? A focus ring shows only for keyboard
 * focus (like :focus-visible), not after a mouse click. Native platforms
 * (TV focus engine, iPad keyboard) always show the ring on focus.
 */
import { Platform } from 'react-native';

import { isTV } from '@/platform/tv';

let keyboard = isTV;

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') keyboard = true;
  }, true);
  document.addEventListener('pointerdown', () => {
    keyboard = isTV;
  }, true);
}

export function focusFromKeyboard(): boolean {
  return Platform.OS !== 'web' || keyboard;
}
