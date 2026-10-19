import type { LibraryQuery, LibrarySortBy } from '@/api/query-keys';

/** The user-chosen part of a library query, remembered per library. */
export type LibraryFilters = Pick<LibraryQuery, 'sortBy' | 'sortOrder' | 'played' | 'favorites' | 'genres' | 'years'>;

export const DEFAULT_FILTERS: LibraryFilters = {
  sortBy: 'SortName',
  sortOrder: 'Ascending',
  played: 'all',
  favorites: false,
  genres: [],
  years: [],
};

export const SORT_OPTIONS: { value: LibrarySortBy; label: string }[] = [
  { value: 'SortName', label: 'Name' },
  { value: 'DateCreated', label: 'Date added' },
  { value: 'PremiereDate', label: 'Release date' },
  { value: 'CommunityRating', label: 'Rating' },
  { value: 'Runtime', label: 'Runtime' },
  { value: 'DatePlayed', label: 'Last played' },
  { value: 'Random', label: 'Random' },
];

/** True when any filter (not the sort) narrows the list. */
export function hasActiveFilters(f: LibraryFilters): boolean {
  return f.played !== 'all' || f.favorites || f.genres.length > 0 || f.years.length > 0;
}

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
