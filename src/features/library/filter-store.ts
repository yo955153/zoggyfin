import { useMemo } from 'react';
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

import { DEFAULT_FILTERS, type LibraryFilters } from './filters';

export { DEFAULT_FILTERS, hasActiveFilters, SORT_OPTIONS, toggle, type LibraryFilters } from './filters';

const KEY = 'library.filters';

interface FilterState {
  byLibrary: Record<string, LibraryFilters>;
  get: (libraryId: string) => LibraryFilters;
  update: (libraryId: string, patch: Partial<LibraryFilters>) => void;
  reset: (libraryId: string) => void;
}

export const useLibraryFilters = create<FilterState>((set, get) => ({
  byLibrary: readJson<Record<string, LibraryFilters>>(KEY, {}),
  get: (id) => ({ ...DEFAULT_FILTERS, ...get().byLibrary[id] }),
  update: (id, patch) => {
    const byLibrary = { ...get().byLibrary, [id]: { ...DEFAULT_FILTERS, ...get().byLibrary[id], ...patch } };
    writeJson(KEY, byLibrary);
    set({ byLibrary });
  },
  reset: (id) => {
    const byLibrary = { ...get().byLibrary };
    delete byLibrary[id];
    writeJson(KEY, byLibrary);
    set({ byLibrary });
  },
}));


/** The filters for one library. Stable between renders while nothing changes. */
export function useFiltersFor(libraryId: string): LibraryFilters {
  const stored = useLibraryFilters((s) => s.byLibrary[libraryId]);
  return useMemo(() => ({ ...DEFAULT_FILTERS, ...stored }), [stored]);
}
