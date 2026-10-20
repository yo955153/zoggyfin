/**
 * The invites this device sent, so the admin sees the open ones. An invite
 * is pending while its user exists, has never signed in, and the invite is
 * younger than `INVITE_DAYS`. After that it is expired: the app deletes the
 * user that never signed in (`expiredUsers`, cleanup.ts), so the link and
 * its one-time password stop working on the server, and keeps the record
 * (marked `expired`) so the admin sees "Expired" and can send it again. The
 * one-time password is not kept: "Send again" sets a new one.
 */
import { readJson, writeJson } from '@/storage/json';

import { INVITE_LIFETIME_MS } from './payload';
import type { InviteOptions } from './policy';

export interface InviteRecord {
  serverId: string;
  userId: string;
  userName: string;
  /** ISO time: when the invite was made or sent again. */
  createdAt: string;
  /** ISO time: when the link stops working. Older records have none: `createdAt` plus `INVITE_DAYS`. */
  expiresAt?: string;
  /** The libraries and permissions, so "Send again" can make the user again after the cleanup. */
  options?: InviteOptions;
  /** The invite expired and the app deleted its user. */
  expired?: boolean;
}

/** The fields of a server user that this needs. */
export interface UserFacts {
  Id?: string | null;
  LastLoginDate?: string | null;
  LastActivityDate?: string | null;
}

/** An invite in the admin's list. */
export interface InviteEntry {
  record: InviteRecord;
  state: 'pending' | 'expired';
  /** Epoch ms. */
  expiresAt: number;
}

const KEY = 'invites.sent';

/** An expired invite stays in the list this long, ms; then the record goes. */
export const EXPIRED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** When the invite stops working, epoch ms (NaN for a record with no valid time). */
export function expiryOf(r: Pick<InviteRecord, 'createdAt' | 'expiresAt'>): number {
  const at = r.expiresAt ? Date.parse(r.expiresAt) : NaN;
  return Number.isFinite(at) ? at : Date.parse(r.createdAt) + INVITE_LIFETIME_MS;
}

function neverSignedIn(u: UserFacts | undefined): boolean {
  return !!u && !u.LastLoginDate && !u.LastActivityDate;
}

/** The state of one record: an open invite, an expired one, or gone (the person joined, or the user is gone). */
function stateOf(r: InviteRecord, user: UserFacts | undefined, now: number): InviteEntry['state'] | null {
  const expiry = expiryOf(r);
  if (user) {
    if (!neverSignedIn(user)) return null;
    return now >= expiry ? 'expired' : 'pending';
  }
  // The app deleted the user at the expiry: the record stays for a while.
  return r.expired && now - expiry < EXPIRED_KEEP_MS ? 'expired' : null;
}

/** The invites of a server for the admin: pending and expired, newest first. */
export function inviteEntries(records: readonly InviteRecord[], serverId: string, users: readonly UserFacts[], now: number): InviteEntry[] {
  const byId = new Map(users.filter((u) => u.Id).map((u) => [u.Id as string, u]));
  const out: InviteEntry[] = [];
  for (const r of records) {
    if (r.serverId !== serverId) continue;
    const state = stateOf(r, byId.get(r.userId), now);
    if (state) out.push({ record: r, state, expiresAt: expiryOf(r) });
  }
  return out.sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
}

/** The pending invites only (the count). */
export function pendingInvites(records: readonly InviteRecord[], serverId: string, users: readonly UserFacts[], now: number): InviteRecord[] {
  return inviteEntries(records, serverId, users, now)
    .filter((e) => e.state === 'pending')
    .map((e) => e.record);
}

/** The users to delete: their invite expired and they never signed in. */
export function expiredUsers(records: readonly InviteRecord[], serverId: string, users: readonly UserFacts[], now: number): InviteRecord[] {
  const byId = new Map(users.filter((u) => u.Id).map((u) => [u.Id as string, u]));
  return records.filter((r) => r.serverId === serverId && neverSignedIn(byId.get(r.userId)) && now >= expiryOf(r));
}

/** Drops the records of a server that the list does not show any more (the person joined, the user is gone, or it expired long ago). */
export function pruneRecords(records: readonly InviteRecord[], serverId: string, users: readonly UserFacts[], now: number): InviteRecord[] {
  const keep = new Set(inviteEntries(records, serverId, users, now).map((e) => e.record.userId));
  return records.filter((r) => r.serverId !== serverId || keep.has(r.userId));
}

/** True when this device has a record of the server whose invite is past its expiry and not cleaned up yet. */
export function hasExpiredWork(records: readonly InviteRecord[], serverId: string, now: number): boolean {
  return records.some((r) => r.serverId === serverId && !r.expired && now >= expiryOf(r));
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

/** Marks a record as expired and cleaned up (its user is deleted). */
export function markExpired(serverId: string, userId: string): void {
  writeRecords(readRecords().map((r) => (r.serverId === serverId && r.userId === userId ? { ...r, expired: true } : r)));
}

/** A new record for an invite made (or sent again) at `now`. */
export function newRecord(fields: Omit<InviteRecord, 'createdAt' | 'expiresAt' | 'expired'>, now: number): InviteRecord {
  return { ...fields, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + INVITE_LIFETIME_MS).toISOString() };
}
