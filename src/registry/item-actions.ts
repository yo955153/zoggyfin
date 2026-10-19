/**
 * The item action registry. An item's action sheet lists every registered
 * action whose `when` accepts the item. Built-in actions register here the
 * same way any later contributor (for example an extension) will.
 */
import type { BaseItemDto } from '@/api/types';
import type { IconName } from '@/components/icon-names';

/** What an action may ask the app to do. The screen that shows the sheet supplies it. */
export interface AppActionApi {
  play(item: BaseItemDto): void;
  openItem(item: BaseItemDto): void;
  setFavorite(item: BaseItemDto, favorite: boolean): Promise<void>;
  setPlayed(item: BaseItemDto, played: boolean): Promise<void>;
}

export interface ItemActionContext {
  item: BaseItemDto;
  app: AppActionApi;
  /** Platform the app runs on, for actions that only make sense on some. */
  platform: 'ios' | 'android' | 'web' | string;
}

export interface ItemAction {
  id: string;
  title: string;
  /** An icon name (see components/icon-names.ts). */
  icon: IconName;
  /** Lower comes first. Built-ins use steps of 10. */
  order?: number;
  destructive?: boolean;
  when?: (ctx: ItemActionContext) => boolean;
  run: (ctx: ItemActionContext) => void | Promise<void>;
}

export interface Registry<T extends { id: string }> {
  register(entry: T): () => void;
  list(): readonly T[];
  subscribe(listener: () => void): () => void;
}

/** A small ordered registry. Registering an existing id replaces it. */
export function createRegistry<T extends { id: string; order?: number }>(): Registry<T> {
  let entries: T[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    register(entry) {
      entries = [...entries.filter((e) => e.id !== entry.id), entry].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100),
      );
      emit();
      return () => {
        entries = entries.filter((e) => e !== entry);
        emit();
      };
    },
    list: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const itemActions = createRegistry<ItemAction>();

export function actionsFor(ctx: ItemActionContext, registry: Registry<ItemAction> = itemActions): ItemAction[] {
  return registry.list().filter((a) => {
    try {
      return a.when ? a.when(ctx) : true;
    } catch {
      // A broken filter hides its action; it never breaks the sheet.
      return false;
    }
  });
}
