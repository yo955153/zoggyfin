/**
 * Other kinds of provider content beside the live channels (for example
 * films and series). Each one is an entry in the Live TV browse column (after
 * All channels, see `iptv/browse.ts`) and a chip on phones, and opens its own
 * page. A new kind adds itself to this list; the Live TV page needs no change.
 */
import type { Href } from 'expo-router';

import type { IconName } from '@/components/icon';
import type { BrowseSection } from '@/iptv';

import type { LiveGroup } from './nav';

export interface LiveTvSection extends BrowseSection {
  icon: IconName;
  /** The page of the section, in the stack the user is in. */
  href: (group: LiveGroup) => Href;
  /** Shown only when this is true for the provider (for example: Xtream only). */
  available?: (provider: { kind: 'xtream' | 'm3u' }) => boolean;
}

export const liveTvSections: LiveTvSection[] = [];
