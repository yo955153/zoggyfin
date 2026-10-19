/**
 * Installed extensions and their setting values, kept on this device.
 * Secret text settings go to the secure store; all else is plain JSON.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';
import { secureStore } from '@/storage/secure';

import type { Grants } from './http';
import type { Manifest, SettingField, SettingSource } from './schema';

export interface InstalledExtension {
  manifestUrl: string;
  manifest: Manifest;
  enabled: boolean;
  grants: Grants;
  installedAt: number;
}

export type SettingValue = string | boolean;
export type Values = Record<string, SettingValue>;

interface ExtensionsState {
  list: InstalledExtension[];
  /** Values the user set, per extension id. */
  values: Record<string, Values>;
  /** Values the app filled in by itself (choice lists matched at install), per extension id. */
  auto: Record<string, Values>;
  /** Choice options fetched from the extension, per extension id and setting key. */
  options: Record<string, Record<string, { value: string; label: string }[]>>;
}

const KEY = 'extensions.v1';
const secretKey = (extId: string, key: string) => `ext.${extId}.${key}`;

function load(): ExtensionsState {
  const saved = readJson<Partial<ExtensionsState>>(KEY, {});
  return {
    list: Array.isArray(saved.list) ? saved.list : [],
    values: saved.values ?? {},
    auto: saved.auto ?? {},
    options: saved.options ?? {},
  };
}

export const useExtensions = create<ExtensionsState>(() => load());

useExtensions.subscribe((st) => writeJson(KEY, { list: st.list, values: st.values, auto: st.auto, options: st.options }));

export const extensionsState = () => useExtensions.getState();

export function getExtension(id: string): InstalledExtension | undefined {
  return useExtensions.getState().list.find((e) => e.manifest.id === id);
}

export function upsertExtension(ext: InstalledExtension): void {
  useExtensions.setState((st) => ({ list: [...st.list.filter((e) => e.manifest.id !== ext.manifest.id), ext] }));
}

export function setEnabled(id: string, enabled: boolean): void {
  useExtensions.setState((st) => ({ list: st.list.map((e) => (e.manifest.id === id ? { ...e, enabled } : e)) }));
}

export function setGrant(id: string, grant: keyof Grants, on: boolean): void {
  useExtensions.setState((st) => ({ list: st.list.map((e) => (e.manifest.id === id ? { ...e, grants: { ...e.grants, [grant]: on } } : e)) }));
}

export function removeExtension(id: string): void {
  const ext = getExtension(id);
  for (const f of ext?.manifest.contributes.settings ?? []) if (f.type === 'text' && f.secret) secureStore.remove(secretKey(id, f.key));
  useExtensions.setState((st) => {
    const { [id]: _v, ...values } = st.values;
    const { [id]: _a, ...auto } = st.auto;
    const { [id]: _o, ...options } = st.options;
    return { list: st.list.filter((e) => e.manifest.id !== id), values, auto, options };
  });
}

export function setValue(extId: string, field: SettingField, value: SettingValue | undefined): void {
  if (field.type === 'text' && field.secret) {
    if (value === undefined || value === '') secureStore.remove(secretKey(extId, field.key));
    else secureStore.set(secretKey(extId, field.key), String(value));
    // Keep a marker so the screen knows a value exists, never the value itself.
    value = value === undefined || value === '' ? undefined : '•';
  }
  useExtensions.setState((st) => {
    const cur = { ...(st.values[extId] ?? {}) };
    if (value === undefined) delete cur[field.key];
    else cur[field.key] = value;
    return { values: { ...st.values, [extId]: cur } };
  });
}

export function setAuto(extId: string, values: Values, options: Record<string, { value: string; label: string }[]>): void {
  useExtensions.setState((st) => ({
    auto: { ...st.auto, [extId]: { ...(st.auto[extId] ?? {}), ...values } },
    options: { ...st.options, [extId]: { ...(st.options[extId] ?? {}), ...options } },
  }));
}

/** The account facts that `source` settings read. */
export interface AccountFacts {
  serverUrl: string;
  serverId: string;
  userId: string;
  userName: string;
  isAdmin: boolean;
}

export function sourceValue(source: SettingSource | undefined, account: AccountFacts | null): SettingValue | undefined {
  if (!source || !account) return undefined;
  switch (source) {
    case 'jellyfin.serverUrl':
      return account.serverUrl;
    case 'jellyfin.serverId':
      return account.serverId;
    case 'jellyfin.userId':
      return account.userId;
    case 'jellyfin.userName':
      return account.userName;
    case 'jellyfin.isAdmin':
      return account.isAdmin;
  }
}

/**
 * The value in use for each setting: what the user set, else what the app
 * filled in, else the account value (`source`), else the default, else the
 * first option.
 */
export function effectiveValues(
  m: Manifest,
  st: Pick<ExtensionsState, 'values' | 'auto' | 'options'>,
  account: AccountFacts | null,
  readSecret: (key: string) => string | null = (k) => secureStore.get(secretKey(m.id, k)),
): Values {
  const out: Values = {};
  const user = st.values[m.id] ?? {};
  const auto = st.auto[m.id] ?? {};
  for (const f of m.contributes.settings ?? []) {
    if (f.type === 'text' && f.secret) {
      const s = user[f.key] !== undefined ? readSecret(f.key) : null;
      out[f.key] = s ?? (f.default ?? '');
      continue;
    }
    const fromSource = f.type === 'choice' ? undefined : sourceValue(f.source, account);
    const firstOption = f.type === 'choice' ? (f.options?.[0]?.value ?? st.options[m.id]?.[f.key]?.[0]?.value) : undefined;
    const fallback = f.type === 'toggle' ? false : '';
    out[f.key] = user[f.key] ?? auto[f.key] ?? fromSource ?? f.default ?? firstOption ?? fallback;
  }
  return out;
}

/** The manifest URLs of the turned-on extensions, for invite links. */
export function extensionsForInvite(): string[] {
  return useExtensions
    .getState()
    .list.filter((e) => e.enabled)
    .map((e) => e.manifestUrl);
}
