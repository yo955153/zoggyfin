import type { BaseItemDto } from '@/api/types';

type UserData = NonNullable<BaseItemDto['UserData']>;

/** A test item with optional user data (the SDK type needs a `Key`). */
export function item(id: string, extra: Partial<BaseItemDto> = {}, userData?: Partial<UserData>): BaseItemDto {
  return { Id: id, Name: id, ...extra, ...(userData ? { UserData: { Key: id, ...userData } } : {}) };
}
