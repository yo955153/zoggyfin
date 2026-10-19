/**
 * Appearance: follow the system, or force dark or light (Settings, Appearance).
 * Saved on the device.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

export type AppearanceChoice = 'system' | 'dark' | 'light';

const KEY = 'settings.appearance';

export const APPEARANCE_OPTIONS: readonly { value: AppearanceChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

function load(): AppearanceChoice {
  const v = readJson<string>(KEY, 'system');
  return v === 'dark' || v === 'light' ? v : 'system';
}

interface AppearanceState {
  choice: AppearanceChoice;
  setChoice: (choice: AppearanceChoice) => void;
}

export const useAppearance = create<AppearanceState>((set) => ({
  choice: load(),
  setChoice: (choice) => {
    writeJson(KEY, choice);
    set({ choice });
  },
}));

/** The scheme to draw with. `system` is the OS value (null or unspecified counts as dark). */
export function resolveScheme(choice: AppearanceChoice, system: string | null | undefined): 'dark' | 'light' {
  if (choice !== 'system') return choice;
  return system === 'light' ? 'light' : 'dark';
}
