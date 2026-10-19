/**
 * The watch-together state for the UI. The nearby and SyncPlay controllers
 * write it; screens read it.
 */
import { create } from 'zustand';

import type { BaseItemDto } from '@/api/types';

import { IDLE, type Phase } from './machine';
import type { Advert, Member, SharedItem } from './protocol';

export type TogetherMode = 'none' | 'nearby' | 'syncplay';

export interface JoinRequest {
  inviteId: string;
  peerId: string;
  name: string;
  /** The guest has the item downloaded. */
  have: boolean;
}

export interface NearbyHost {
  peerId: string;
  advert: Advert;
}

export interface SyncQuality {
  /** Clock offset to the host or server, ms. */
  offset: number;
  /** Round trip, ms. */
  rtt: number;
  /** Last measured drift, ms (positive: behind). */
  drift: number | null;
}

export interface SyncPlayGroupView {
  id: string;
  name: string;
  state: string;
  participants: string[];
}

export interface TogetherState {
  mode: TogetherMode;
  role: 'host' | 'guest' | null;
  phase: Phase;
  item: SharedItem | null;
  /** Nearby: other members (the host sees guests; a guest sees the other guests). SyncPlay: user names. */
  members: Member[];
  hostName: string | null;
  onlyHostControls: boolean;
  /** Host: join requests that wait for an answer. */
  requests: JoinRequest[];
  /** Guest: hosts found nearby. */
  hosts: NearbyHost[];
  sync: SyncQuality | null;
  /** The group waits for a member that buffers. */
  waiting: boolean;
  /** Guest: where the media comes from. */
  source: 'local' | 'stream' | null;
  /** A short message for the session sheet ("Only the host controls playback."). */
  notice: string | null;
  /** The session sheet: open or closed, the screen that shows it and the item it starts with. */
  sheet: { open: boolean; where: 'player' | 'item'; item: BaseItemDto | null };
  syncplay: {
    groups: SyncPlayGroupView[];
    group: SyncPlayGroupView | null;
    loading: boolean;
    error: string | null;
  };
}

export const initialTogether: TogetherState = {
  mode: 'none',
  role: null,
  phase: IDLE,
  item: null,
  members: [],
  hostName: null,
  onlyHostControls: false,
  requests: [],
  hosts: [],
  sync: null,
  waiting: false,
  source: null,
  notice: null,
  sheet: { open: false, where: 'item', item: null },
  syncplay: { groups: [], group: null, loading: false, error: null },
};

export const useTogetherStore = create<TogetherState>(() => initialTogether);

export const togetherState = () => useTogetherStore.getState();
export const setTogether = (patch: Partial<TogetherState>) => useTogetherStore.setState(patch);
export const setSyncPlayView = (patch: Partial<TogetherState['syncplay']>) =>
  useTogetherStore.setState((s) => ({ syncplay: { ...s.syncplay, ...patch } }));

export function openTogetherSheet(where: 'player' | 'item', item: BaseItemDto | null): void {
  setTogether({ sheet: { open: true, where, item } });
}

export function closeTogetherSheet(): void {
  useTogetherStore.setState((s) => ({ sheet: { ...s.sheet, open: false } }));
}

/** True while a session runs (nearby or SyncPlay group). */
export function useInTogether(): boolean {
  return useTogetherStore((s) => s.mode !== 'none' && (s.phase.name === 'hosting' || s.phase.name === 'syncing' || s.phase.name === 'joined' || s.syncplay.group !== null));
}
