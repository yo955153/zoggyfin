import { create } from 'zustand';

interface ToastState {
  message: string | null;
  id: number;
  show: (message: string) => void;
  hide: () => void;
}

/** One short message at a time, shown above the tab bar. Works the same on web. */
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  id: 0,
  show: (message) => set((s) => ({ message, id: s.id + 1 })),
  hide: () => set({ message: null }),
}));

export function toast(message: string): void {
  useToastStore.getState().show(message);
}
