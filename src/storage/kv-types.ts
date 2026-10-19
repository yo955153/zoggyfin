/** A small synchronous key-value store. Native uses MMKV; web uses localStorage. */
export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  clearAll(): void;
}
