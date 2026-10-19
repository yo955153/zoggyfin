/**
 * Playlist changes. Each one writes the server through `@jellyfin/sdk`
 * (PlaylistsApi) and keeps the TanStack Query cache right: reorder and
 * remove change the cached list at once (optimistic) and roll back on an
 * error; every change then invalidates the playlist, its entries and the
 * playlist lists.
 */
import { router } from 'expo-router';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryClient } from '@/api/query-client';
import { queryKeys, type SessionScope } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { toast } from '@/lib/toast';
import { readJson, writeJson } from '@/storage/json';

import { moveEntry, playlistMediaFor, playlistName, removeEntries, touchRecent } from './logic';

const RECENT_KEY = 'playlists.recent';

function ctx() {
  const s = useSessionStore.getState().session;
  if (!s) throw new Error('Sign in first.');
  const scope: SessionScope = { serverId: s.serverId, userId: s.userId };
  return { api: getApi(s.serverUrl, s.token), userId: s.userId, scope };
}

export function recentPlaylistIds(): string[] {
  return readJson<string[]>(RECENT_KEY, []);
}

function markRecent(id: string) {
  writeJson(RECENT_KEY, touchRecent(recentPlaylistIds(), id));
}

function entriesKey(scope: SessionScope, playlistId: string) {
  return queryKeys.children(scope, playlistId, 'playlist');
}

function refresh(scope: SessionScope, playlistId?: string) {
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.all(scope), 'playlists'] });
  // The Music tab's Playlists page.
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.all(scope), 'music'] });
  if (playlistId) {
    void queryClient.invalidateQueries({ queryKey: entriesKey(scope, playlistId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.item(scope, playlistId) });
  }
}

function fail(e: unknown) {
  toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
}

function openAction(id: string, name: string) {
  return {
    label: 'Open',
    onPress: () => router.navigate({ pathname: '/(tabs)/(music)/item/[id]', params: { id, type: 'Playlist', name } } as never),
  };
}

/** Adds items to a playlist. Returns true when it worked. */
export async function addItems(playlist: BaseItemDto, items: BaseItemDto[]): Promise<boolean> {
  const { api, userId, scope } = ctx();
  const ids = items.map((i) => i.Id).filter((x): x is string => !!x);
  if (!playlist.Id || !ids.length) return false;
  try {
    await jf.addToPlaylist(api, userId, playlist.Id, ids);
    markRecent(playlist.Id);
    toast(`Added to ${playlist.Name ?? 'the playlist'}`, { icon: 'checkmark', action: openAction(playlist.Id, playlist.Name ?? '') });
    refresh(scope, playlist.Id);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

/** Creates a playlist with the items in one step. */
export async function createWith(nameInput: string, items: BaseItemDto[]): Promise<string | null> {
  const { api, userId, scope } = ctx();
  const name = playlistName(nameInput);
  const ids = items.map((i) => i.Id).filter((x): x is string => !!x);
  try {
    const id = await jf.createPlaylist(api, userId, name, ids, playlistMediaFor(items));
    markRecent(id);
    toast(`Added to ${name}`, { icon: 'checkmark', action: openAction(id, name) });
    refresh(scope, id);
    return id;
  } catch (e) {
    fail(e);
    return null;
  }
}

/** Moves one entry to `to` (its final index). Optimistic. */
export async function moveItem(playlistId: string, from: number, to: number): Promise<void> {
  const { api, scope } = ctx();
  const key = entriesKey(scope, playlistId);
  const before = queryClient.getQueryData<BaseItemDto[]>(key);
  const entry = before?.[from];
  if (!before || !entry?.PlaylistItemId || from === to) return;
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData(key, moveEntry(before, from, to));
  try {
    await jf.movePlaylistItem(api, playlistId, entry.PlaylistItemId, to);
  } catch (e) {
    queryClient.setQueryData(key, before);
    fail(e);
  } finally {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/** Removes entries (by PlaylistItemId). Optimistic. */
export async function removeItems(playlistId: string, entries: BaseItemDto[]): Promise<void> {
  const { api, scope } = ctx();
  const key = entriesKey(scope, playlistId);
  const before = queryClient.getQueryData<BaseItemDto[]>(key);
  const ids = entries.map((e) => e.PlaylistItemId).filter((x): x is string => !!x);
  if (!ids.length) return;
  await queryClient.cancelQueries({ queryKey: key });
  if (before) queryClient.setQueryData(key, removeEntries(before, ids));
  try {
    await jf.removeFromPlaylist(api, playlistId, ids);
    toast(ids.length === 1 ? `Removed ${entries[0]?.Name ?? 'the item'}` : `Removed ${ids.length} items`, { icon: 'checkmark' });
  } catch (e) {
    if (before) queryClient.setQueryData(key, before);
    fail(e);
  } finally {
    refresh(scope, playlistId);
  }
}

export async function rename(playlist: BaseItemDto, nameInput: string): Promise<boolean> {
  const { api, scope } = ctx();
  const name = playlistName(nameInput, playlist.Name ?? 'Playlist');
  if (!playlist.Id || name === playlist.Name) return true;
  const key = queryKeys.item(scope, playlist.Id);
  const before = queryClient.getQueryData<BaseItemDto>(key);
  if (before) queryClient.setQueryData(key, { ...before, Name: name });
  try {
    await jf.renamePlaylist(api, playlist.Id, name);
    toast(`Renamed to ${name}`, { icon: 'checkmark' });
    return true;
  } catch (e) {
    if (before) queryClient.setQueryData(key, before);
    fail(e);
    return false;
  } finally {
    refresh(scope, playlist.Id);
  }
}

export async function remove(playlist: BaseItemDto): Promise<boolean> {
  const { api, scope } = ctx();
  if (!playlist.Id) return false;
  try {
    await jf.deletePlaylist(api, playlist.Id);
    writeJson(RECENT_KEY, recentPlaylistIds().filter((x) => x !== playlist.Id));
    queryClient.removeQueries({ queryKey: queryKeys.item(scope, playlist.Id) });
    toast(`Deleted ${playlist.Name ?? 'the playlist'}`, { icon: 'checkmark' });
    refresh(scope);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
