import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { useOpenItem } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { usePlayer } from '@/player';
import { actionsFor, type AppActionApi, type ItemAction, itemActions } from '@/registry/item-actions';

import { registerBuiltinItemActions } from './builtin';

registerBuiltinItemActions();

/** The actions for an item, plus a runner that supplies the app API. */
export function useItemActions(item: BaseItemDto | undefined) {
  const { api, userId, scope } = useApi();
  const qc = useQueryClient();
  const openItem = useOpenItem();
  const player = usePlayer();
  const version = useSyncExternalStore(itemActions.subscribe, itemActions.list, itemActions.list);

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
      openItem,
      setFavorite: (it, fav) =>
        guard(() => jf.setFavorite(api, userId, it.Id ?? '', fav), fav ? 'Added to favourites' : 'Removed from favourites'),
      setPlayed: (it, played) =>
        guard(() => jf.setPlayed(api, userId, it.Id ?? '', played), played ? 'Marked as played' : 'Marked as unplayed'),
    };
  }, [api, userId, scope, qc, openItem, player]);

  const actions = useMemo(
    () => (item ? actionsFor({ item, app, platform: Platform.OS }) : []),
    // `version` changes when the registry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, app, version],
  );

  const run = (action: ItemAction) => {
    if (!item) return;
    Promise.resolve(action.run({ item, app, platform: Platform.OS })).catch((e: unknown) =>
      toast(describeError(e).title),
    );
  };
  return { actions, run, app };
}
