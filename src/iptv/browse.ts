/**
 * The Live TV browse column: what it lists, in which order, and which group
 * a provider opens on. Order, top to bottom:
 * 1. Search (always first: the quickest way to a channel),
 * 2. Favourites, when it has channels,
 * 3. Recently watched, when it has channels,
 * 4. All channels,
 * 5. Favourites, when it is empty (it explains how to add one),
 * 6. the sections of other kinds of content (for example films and series),
 * 7. a "Groups" heading and the provider's groups, in the provider's order,
 * 8. Providers (add, edit, reload or remove one), last.
 * Pure, so it is unit-tested.
 */
import { ALL_GROUP, FAVOURITES_GROUP, type GroupView, RECENTS_GROUP } from './lists';

export const SEARCH_ENTRY = 'search';
export const PROVIDERS_ENTRY = 'providers';

/** Another kind of content beside the live channels (a page of its own). */
export interface BrowseSection {
  key: string;
  label: string;
}

export type BrowseEntry =
  | { kind: 'search'; key: typeof SEARCH_ENTRY }
  | { kind: 'group'; key: string; group: GroupView }
  | { kind: 'section'; key: string; section: BrowseSection }
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'providers'; key: typeof PROVIDERS_ENTRY };

export function browseEntries(groups: readonly GroupView[], sections: readonly BrowseSection[] = []): BrowseEntry[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const fav = byKey.get(FAVOURITES_GROUP);
  const recent = byKey.get(RECENTS_GROUP);
  const all = byKey.get(ALL_GROUP);
  const own = groups.filter((g) => g.key !== FAVOURITES_GROUP && g.key !== RECENTS_GROUP && g.key !== ALL_GROUP && g.count > 0);
  const out: BrowseEntry[] = [{ kind: 'search', key: SEARCH_ENTRY }];
  const group = (g: GroupView | undefined) => {
    if (g) out.push({ kind: 'group', key: g.key, group: g });
  };
  if (fav && fav.count > 0) group(fav);
  if (recent && recent.count > 0) group(recent);
  group(all);
  if (fav && fav.count === 0) group(fav);
  for (const s of sections) out.push({ kind: 'section', key: `section:${s.key}`, section: s });
  if (own.length) {
    out.push({ kind: 'heading', key: 'heading:groups', label: 'Groups' });
    for (const g of own) group(g);
  }
  out.push({ kind: 'providers', key: PROVIDERS_ENTRY });
  return out;
}

/** The group a provider opens on: Favourites when it has channels, else All channels. */
export function defaultGroup(groups: readonly GroupView[]): string {
  const fav = groups.find((g) => g.key === FAVOURITES_GROUP);
  return fav && fav.count > 0 ? FAVOURITES_GROUP : ALL_GROUP;
}

/** The picked group, or the default when the pick is gone (a refresh removed the group). */
export function resolveGroup(groups: readonly GroupView[], picked: string | null): string {
  if (picked && groups.some((g) => g.key === picked)) return picked;
  return defaultGroup(groups);
}
