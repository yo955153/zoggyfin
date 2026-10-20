/**
 * The watch-together state for the UI. The nearby and SyncPlay controllers
 * write it; screens read it.
 */
import { create } from 'zustand';

import type { BaseItemDto } from '@/api/types';

import { IDLE, type Phase } from './machine';
import type { BleState } from './link-native-types';
import type { Advert, MediaKind, Member, SharedItem } from './protocol';

export type TogetherMode = 'none' | 'nearby' | 'syncplay';

/**
 * The screen that shows the session sheet. `join`: a screen with no item
 * (sign-in, offline banner) that only joins. `music`: the music player.
 */
export type SheetPlace = 'player' | 'item' | 'join' | 'music';

export interface JoinRequest {
  inviteId: string;
  peerId: string;
  name: string;
  /** The guest has the item downloaded. */
  have: boolean;
  /** The guest scanned or typed the host's code. */
  code?: boolean;
  /** The request came over Bluetooth (the devices then make a Wi-Fi link). */
  ble?: boolean;
}

export interface NearbyHost {
  /** A service id (found on the network) or a Bluetooth peer id. */
  peerId: string;
  advert: Advert;
  /** `ble`: found over Bluetooth only; a join first makes a Wi-Fi link. */
  via: 'network' | 'ble';
}

/** What the host shows so that guests can join by code. */
export interface JoinCodeView {
  link: string;
  short: string;
}

/** A session that this device was in, saved for a short time so a restarted app can join it again. */
export interface SavedSession {
  sessionId: string;
  key: string;
  epoch: number;
  role: 'host' | 'guest';
  hostName: string;
  title: string;
  kind: MediaKind;
  memberId: string;
  /** The video item of the session (a host can start it again). */
  itemId: string | null;
  at: number;
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
  /** What the session shares. */
  kind: MediaKind;
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
  sheet: { open: boolean; where: SheetPlace; item: BaseItemDto | null };
  syncplay: {
    groups: SyncPlayGroupView[];
    group: SyncPlayGroupView | null;
    loading: boolean;
    error: string | null;
  };
  /** Host: the join code (QR link and short code). */
  joinCode: JoinCodeView | null;
  /** Host: who can find the session ("Apple devices nearby (direct)"). */
  visibleTo: string[];
  /** The Wi-Fi network this device made for the session (Android), for the Wi-Fi QR code. */
  hotspot: { ssid: string; password: string } | null;
  /** A Bluetooth rendezvous in progress: the step text for the sheet. */
  rendezvous: { text: string; failed: boolean } | null;
  /** When the guest started to look (ms, Date.now), for the help card. */
  browsingSince: number | null;
  localNetwork: 'denied' | 'ok' | 'unknown';
  ble: BleState | null;
  /** A session from before an app restart that can be joined again. */
  rejoin: SavedSession | null;
}

export const initialTogether: TogetherState = {
  mode: 'none',
  kind: 'video',
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
  joinCode: null,
  visibleTo: [],
  hotspot: null,
  rendezvous: null,
  browsingSince: null,
  localNetwork: 'unknown',
  ble: null,
  rejoin: null,
};

export const useTogetherStore = create<TogetherState>(() => initialTogether);

export const togetherState = () => useTogetherStore.getState();
export const setTogether = (patch: Partial<TogetherState>) => useTogetherStore.setState(patch);
export const setSyncPlayView = (patch: Partial<TogetherState['syncplay']>) =>
  useTogetherStore.setState((s) => ({ syncplay: { ...s.syncplay, ...patch } }));

export function openTogetherSheet(where: SheetPlace, item: BaseItemDto | null): void {
  setTogether({ sheet: { open: true, where, item } });
}

export function closeTogetherSheet(): void {
  useTogetherStore.setState((s) => ({ sheet: { ...s.sheet, open: false } }));
}

/** True while a session runs (nearby or SyncPlay group). */
export function useInTogether(): boolean {
  return useTogetherStore(
    (s) =>
      s.mode !== 'none' &&
      (s.phase.name === 'hosting' || s.phase.name === 'syncing' || s.phase.name === 'joined' || s.phase.name === 'reconnecting' || s.syncplay.group !== null),
  );
}
