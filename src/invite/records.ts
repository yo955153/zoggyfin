/**
 * The invites this device sent, so the admin sees the pending ones. An
 * invite is pending while its user exists and has never signed in. The
 * one-time password is not kept: "Resend" sets a new one.
 */
import { readJson, writeJson } from '@/storage/json';

export interface InviteRecord {
  serverId: string;
  userId: string;
  userName: string;
  /** ISO time. */
  createdAt: string;
}

/** The fields of a server user that this needs. */
export interface UserFacts {
  Id?: string | null;
  LastLoginDate?: string | null;
  LastActivityDate?: string | null;
}

const KEY = 'invites.sent';

export function pendingInvites(records: readonly InviteRecord[], serverId: string, users: readonly UserFacts[]): InviteRecord[] {
  const byId = new Map(users.filter((u) => u.Id).map((u) => [u.Id as string, u]));
  return records
    .filter((r) => r.serverId === serverId)
    .filter((r) => {
      const u = byId.get(r.userId);
      return !!u && !u.LastLoginDate && !u.LastActivityDate;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Drops the records of a server whose user signed in or is gone. */
export function pruneRecords(records: readonly InviteRecord[], serverId: string, users: readonly UserFacts[]): InviteRecord[] {
  const keep = new Set(pendingInvites(records, serverId, users).map((r) => r.userId));
  return records.filter((r) => r.serverId !== serverId || keep.has(r.userId));
}

export function readRecords(): InviteRecord[] {
  const v = readJson<unknown>(KEY, []);
  return Array.isArray(v) ? (v as InviteRecord[]).filter((r) => r && typeof r.userId === 'string' && typeof r.serverId === 'string') : [];
}

export function writeRecords(records: readonly InviteRecord[]): void {
  writeJson(KEY, records);
}

export function addRecord(record: InviteRecord): void {
  writeRecords([...readRecords().filter((r) => !(r.serverId === record.serverId && r.userId === record.userId)), record]);
}

export function removeRecord(serverId: string, userId: string): void {
  writeRecords(readRecords().filter((r) => !(r.serverId === serverId && r.userId === userId)));
}
