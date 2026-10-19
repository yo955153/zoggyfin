/**
 * The Home section registry. Home renders every registered section in order.
 * Built-in rows (Continue Watching, Next Up, Recently Added) register here
 * the same way later contributors will.
 */
import type { ComponentType } from 'react';

import { createRegistry } from './item-actions';

export interface HomeSection {
  id: string;
  order?: number;
  /** Renders the section. It hides itself when it has nothing to show. */
  component: ComponentType;
}

export const homeSections = createRegistry<HomeSection>();
