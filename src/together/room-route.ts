/**
 * The room's routing rules, pure so that they are easy to test:
 * - what a Play button does in a nearby room (`routeInRoom`);
 * - a guest's play request as a pick for the host, and back (`pickOf`,
 *   `requestOfPick`);
 * - the key of what a room plays (`mediaKey`, `guestKeyOf`).
 */
import type { BaseItemDto } from '@/api/types';
import type { PlayRequest } from '@/player/types';

import { MAX_PICK_ITEMS, type MediaKind, type PickItem, type PickRequest, type SharedItem } from './protocol';

/** The fields of the player's "now playing" that the key needs. */
interface NowFacts {
  kind: 'video' | 'audio';
  item: { Id?: string | null };
}

/** What a room plays, as one key: `video:<id>`, `audio` (the queue changes on its own), or null. */
export function mediaKey(now: NowFacts | null | undefined): string | null {
  if (!now) return null;
  return now.kind === 'audio' ? 'audio' : `video:${now.item.Id ?? ''}`;
}

/** The guest's key of the room's item (the same form as `mediaKey`; `none` for an empty room). */
export function guestKeyOf(kind: MediaKind, item: Pick<SharedItem, 'id'> | null): string {
  if (!item) return 'none';
  return kind === 'audio' ? 'audio' : `video:${item.id}`;
}

/** This device in a nearby room: the host, a guest (with the host's rule), or neither. */
export type RoomRole = { role: 'host' } | { role: 'guest'; onlyHostControls: boolean } | { role: 'none' };

/**
 * What a Play button does in a nearby room:
 * - `here`: play this request on this device (no room; or the host, whose
 *   room then shares it; a video loads paused, and the group starts it);
 * - `pick`: a guest asks the host to play it for everyone;
 * - `denied`: a guest when only the host picks.
 * `audio`: the request is for audio (it starts at once; the room follows).
 */
export type RoomRoute = { kind: 'here'; request: PlayRequest } | { kind: 'pick'; pick: PickRequest } | { kind: 'denied'; reason: string };

export const ONLY_HOST_PICKS_TEXT = 'Only the host picks what plays.';

export function routeInRoom(who: RoomRole, request: PlayRequest, audio: boolean): RoomRoute {
  switch (who.role) {
    case 'none':
      return { kind: 'here', request };
    case 'host':
      return { kind: 'here', request: audio ? request : { ...request, autoplay: false } };
    case 'guest':
      return who.onlyHostControls ? { kind: 'denied', reason: ONLY_HOST_PICKS_TEXT } : { kind: 'pick', pick: pickOf(request) };
  }
}

function pickItem(i: BaseItemDto): PickItem {
  return { id: i.Id ?? '', name: i.Name ?? '', type: i.Type ?? 'Video', serverId: i.ServerId ?? null, mediaType: i.MediaType ?? null };
}

/** A guest's play request as a pick for the host (a list is cut to `MAX_PICK_ITEMS` around the item). */
export function pickOf(r: PlayRequest): PickRequest {
  const list = r.list?.filter((i) => !!i.Id);
  let index = r.index;
  let cut = list;
  if (list && list.length > MAX_PICK_ITEMS) {
    const at = Math.max(0, index ?? list.findIndex((i) => i.Id === r.item.Id));
    const from = Math.max(0, Math.min(at - 20, list.length - MAX_PICK_ITEMS));
    cut = list.slice(from, from + MAX_PICK_ITEMS);
    index = at - from;
  }
  return {
    item: pickItem(r.item),
    ...(r.queue?.length ? { queue: r.queue.filter((i) => !!i.Id).slice(0, 50).map(pickItem) } : {}),
    ...(cut?.length ? { list: cut.map(pickItem), index: index ?? 0 } : {}),
    ...(r.context?.Id ? { context: pickItem(r.context) } : {}),
    ...(r.shuffle ? { shuffle: true } : {}),
    ...(r.startPositionTicks !== undefined ? { start: Math.max(0, r.startPositionTicks) } : {}),
  };
}

function itemOfPick(p: PickItem): BaseItemDto {
  return {
    Id: p.id,
    Name: p.name,
    Type: p.type as BaseItemDto['Type'],
    ServerId: p.serverId ?? undefined,
    MediaType: (p.mediaType ?? undefined) as BaseItemDto['MediaType'],
  };
}

/** The host's play request for a guest's pick. */
export function requestOfPick(p: PickRequest): PlayRequest {
  return {
    item: itemOfPick(p.item),
    ...(p.queue ? { queue: p.queue.map(itemOfPick) } : {}),
    ...(p.list?.length ? { list: p.list.map(itemOfPick), index: Math.min(p.index ?? 0, p.list.length - 1) } : {}),
    ...(p.context ? { context: itemOfPick(p.context) } : {}),
    ...(p.shuffle ? { shuffle: true } : {}),
    ...(p.start !== undefined ? { startPositionTicks: p.start } : {}),
  };
}
