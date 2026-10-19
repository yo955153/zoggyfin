import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { router } from 'expo-router';

import { downloads, downloadsSupported } from '@/downloads';
import { downloadsState, statusOf, useDownloadsStore } from '@/downloads/store';
import { openAddToPlaylist, openRenamePlaylist } from '@/features/playlists/add-to-playlist';
import * as playlistOps from '@/features/playlists/ops';
import { confirmDestructive } from '@/lib/confirm';
import { formatBytes } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { usePlayer } from '@/player';
import { actionsFor, actionTitle, type AppActionApi, type ItemAction, itemActions } from '@/registry/item-actions';

import { registerBuiltinItemActions } from './builtin';

registerBuiltinItemActions();

/** The actions for an item, plus a runner that supplies the app API. */
export function useItemActions(item: BaseItemDto | undefined) {
  const { api, userId, scope } = useApi();
  const qc = useQueryClient();
  const openItem = useOpenItem();
  const player = usePlayer();
  const version = useSyncExternalStore(itemActions.subscribe, itemActions.list, itemActions.list);
  // The download actions change with the item's download state.
  const dlKey = useDownloadsStore((s) => {
    if (!item?.Id || !downloadsSupported) return 'none';
    const st = statusOf(item.Id, s);
    return st.state === 'none' || st.state === 'completed' ? st.state : `${st.state}:${st.progress}`;
  });

  const app = useMemo<AppActionApi>(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.all(scope) });
    const guard = async (fn: () => Promise<void>, done: string) => {
      try {
        await fn();
        toast(done, { icon: 'checkmark' });
        await refresh();
      } catch (e) {
        toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
      }
    };
    return {
      play: (it) => player.play({ item: it }),
      playNext: (it) => player.playNext(it),
      addToQueue: (it) => player.addToQueue(it),
      instantMix: (it) => player.instantMix(it),
      openItem,
      setFavorite: (it, fav) =>
        guard(() => jf.setFavorite(api, userId, it.Id ?? '', fav), fav ? 'Added to favourites' : 'Removed from favourites'),
      setPlayed: (it, played) =>
        guard(() => jf.setPlayed(api, userId, it.Id ?? '', played), played ? 'Marked as played' : 'Marked as unplayed'),
      addToPlaylist: (it) => openAddToPlaylist(it),
      renamePlaylist: (it) => openRenamePlaylist(it),
      deletePlaylist: async (it) => {
        const ok = await confirmDestructive(`Delete ${it.Name ?? 'this playlist'}?`, 'The playlist is removed from the server for this account. The songs and videos in it stay in the library.', 'Delete');
        if (ok && (await playlistOps.remove(it)) && router.canGoBack()) router.back();
      },
      ...(downloadsSupported
        ? {
            downloadStatus: (it: BaseItemDto) => statusOf(it.Id ?? '', downloadsState()),
            download: (it: BaseItemDto) => void downloads.download(it),
            removeDownload: async (it: BaseItemDto) => {
              const s = downloadsState();
              const id = it.Id ?? '';
              const ids = s.collections[id]?.itemIds ?? [id];
              const bytes = ids.reduce((n, x) => n + (s.records[x]?.bytesDone ?? 0), 0);
              const ok = await confirmDestructive(`Remove the download of ${it.Name ?? 'this item'}?`, `This frees ${formatBytes(bytes)} on this device. Nothing changes on the server.`, 'Remove');
              if (!ok) return;
              await (s.collections[id] ? downloads.removeGroup(id) : downloads.remove(id));
              toast('Download removed', { icon: 'checkmark' });
            },
            openDownloads: () => router.navigate('/(tabs)/(downloads)/downloads'),
          }
        : null),
    };
  }, [api, userId, scope, qc, openItem, player]);

  const actions = useMemo(
    () => (item ? actionsFor({ item, app, platform: Platform.OS }) : []),
    // `version` changes when the registry changes; `dlKey` when the download state does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, app, version, dlKey],
  );
  const titleOf = (action: ItemAction) => (item ? actionTitle(action, { item, app, platform: Platform.OS }) : action.title);

  const run = (action: ItemAction) => {
    if (!item) return;
    Promise.resolve(action.run({ item, app, platform: Platform.OS })).catch((e: unknown) =>
      toast(describeError(e).title),
    );
  };
  return { actions, run, app, titleOf };
}
