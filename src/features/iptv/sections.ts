/**
 * The provider's other kinds of content beside the live channels: Films and
 * Series. Each one is an entry in the Live TV browse column (after All
 * channels, see `iptv/browse.ts`) and a chip on phones, and opens its own
 * page (`vod/`). A section shows only when the provider has that kind
 * (`useVodKinds`). A new kind adds itself to this list; the Live TV page
 * needs no change.
 */
import type { Href } from 'expo-router';

import type { IconName } from '@/components/icon';
import type { BrowseSection } from '@/iptv';

import type { LiveGroup } from './nav';
import { vodHomeHref } from './vod/vod-nav';

export interface VodKinds {
  film: boolean;
  series: boolean;
}

export interface LiveTvSection extends BrowseSection {
  icon: IconName;
  /** The page of the section, in the stack the user is in. */
  href: (group: LiveGroup, providerId: string) => Href;
  /** True when the provider has this kind of content. */
  available: (kinds: VodKinds) => boolean;
}

export const liveTvSections: LiveTvSection[] = [
  { key: 'films', label: 'Films', icon: 'film', href: (g, p) => vodHomeHref(g, 'film', p), available: (k) => k.film },
  { key: 'series', label: 'Series', icon: 'tv', href: (g, p) => vodHomeHref(g, 'series', p), available: (k) => k.series },
];
