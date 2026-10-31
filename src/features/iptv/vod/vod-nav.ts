/**
 * Where the film and series pages live: under Live TV, shared by the Home,
 * Library and Live TV stacks like the other Live TV pages (`../nav.ts`).
 * Every page names its provider (`p`), so a page stays on the provider it
 * opened with when the active provider changes.
 */
import type { Href } from 'expo-router';

import type { VodKind } from '@/iptv';

import type { LiveGroup } from '../nav';

const root = (group: LiveGroup) => `/(tabs)/${group}/live-tv`;

/** The Films or Series page (categories, Continue watching, search). */
export function vodHomeHref(group: LiveGroup, kind: VodKind, providerId: string): Href {
  return { pathname: `${root(group)}/${kind === 'film' ? 'films' : 'series'}`, params: { p: providerId } } as unknown as Href;
}

/** The poster grid of a category. */
export function vodCategoryHref(group: LiveGroup, kind: VodKind, providerId: string, categoryId: string, name: string): Href {
  return { pathname: `${root(group)}/${kind === 'film' ? 'films' : 'series'}/[category]`, params: { category: categoryId, p: providerId, name } } as unknown as Href;
}

/** The page of a film or a series. */
export function vodDetailHref(group: LiveGroup, kind: VodKind, providerId: string, id: string): Href {
  return { pathname: `${root(group)}/${kind === 'film' ? 'film' : 'show'}/[id]`, params: { id, p: providerId } } as unknown as Href;
}
