import type { ReactNode } from 'react';

export interface PagerTab {
  key: string;
  title: string;
}

export interface TabPagerProps {
  tabs: PagerTab[];
  /** Renders a page. Pages mount on first visit and stay mounted. */
  renderPage: (tab: PagerTab, index: number) => ReactNode;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
}
