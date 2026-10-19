import { create } from 'zustand';

import type { IconName } from '@/components/icon-names';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  icon?: IconName;
  action?: ToastAction;
}

interface ToastState {
  current: ToastMessage | null;
  show: (text: string, opts?: { icon?: IconName; action?: ToastAction }) => void;
  hide: (id?: number) => void;
}

let next = 1;

/** One toast at a time (design system §7.14): a new one replaces the old. */
export const useToastStore = create<ToastState>((set, get) => ({
  current: null,
  show: (text, opts) => set({ current: { id: next++, text, icon: opts?.icon, action: opts?.action } }),
  hide: (id) => {
    if (id === undefined || get().current?.id === id) set({ current: null });
  },
}));

export function toast(text: string, opts?: { icon?: IconName; action?: ToastAction }): void {
  useToastStore.getState().show(text, opts);
}

/** Visible time: 3.2 s, or 6 s with an action. */
export function toastDuration(m: Pick<ToastMessage, 'action'>): number {
  return m.action ? 6000 : 3200;
}
