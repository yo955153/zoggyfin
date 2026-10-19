/**
 * The extension manifest (schema version 1). An extension is data only: the
 * app reads this file and draws its contributions. No code from an extension
 * runs in the app (App Store guideline 2.5.2). See docs/extensions.md.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use lower-case letters, digits, ".", "_" and "-"');
/** A setting or input key, as used in templates (`{{settings.apiKey}}`). */
const keyName = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Use letters, digits and "_", starting with a letter');
const label = z.string().min(1).max(80);
const text = z.string().max(500);
/** A path under `baseUrl` ("/api/x") or a full URL on the same origin. */
const path = z.string().min(1).max(500);

export const PERMISSIONS = ['network', 'itemPath', 'jellyfinToken'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Values the app fills in by itself, so an install needs no typing. The
 * user can still change a filled value.
 */
export const SETTING_SOURCES = ['jellyfin.serverUrl', 'jellyfin.serverId', 'jellyfin.userId', 'jellyfin.userName', 'jellyfin.isAdmin'] as const;
export type SettingSource = (typeof SETTING_SOURCES)[number];

const settingBase = { key: keyName, label, description: text.optional() };
export const settingSchema = z.discriminatedUnion('type', [
  z.object({
    ...settingBase,
    type: z.literal('text'),
    secret: z.boolean().optional(),
    placeholder: text.optional(),
    default: z.string().max(500).optional(),
    source: z.enum(SETTING_SOURCES).optional(),
  }),
  z.object({ ...settingBase, type: z.literal('toggle'), default: z.boolean().optional(), source: z.literal('jellyfin.isAdmin').optional() }),
  z.object({
    ...settingBase,
    type: z.literal('choice'),
    options: z.array(z.object({ value: z.string().max(200), label })).max(100).optional(),
    /** An endpoint that returns the options. The app fetches it at install and when the settings open. */
    optionsSource: path.optional(),
    /** Pick the first option whose value or label matches a Jellyfin library name (without case). */
    matchLibrary: z.boolean().optional(),
    default: z.string().max(200).optional(),
  }),
]);
export type SettingField = z.infer<typeof settingSchema>;

const requestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  path,
  /** Query values. Each string is a template. */
  query: z.record(z.string().max(500)).optional(),
  /** A JSON body. Each string value is a template. */
  body: z.record(z.unknown()).optional(),
});
export type RequestSpec = z.infer<typeof requestSchema>;

const inputBase = { key: keyName, title: label, message: text.optional() };
export const inputSchema = z.discriminatedUnion('type', [
  z.object({ ...inputBase, type: z.literal('text'), placeholder: text.optional(), default: z.string().max(500).optional() }),
  z.object({
    ...inputBase,
    type: z.literal('choice'),
    /** Fixed options, or `source`: an endpoint that returns them. */
    options: z.array(z.object({ value: z.string().max(200), label })).max(100).optional(),
    source: path.optional(),
    default: z.string().max(200).optional(),
  }),
]);
export type InputSpec = z.infer<typeof inputSchema>;

const confirmSchema = z.object({ title: label, message: text.optional(), action: z.string().min(1).max(40).default('Continue') });

/** Which items an action shows on. Every given field must match; an empty filter matches all items. */
export const whenSchema = z.object({
  types: z.array(z.string().max(40)).max(30).optional(),
  mediaTypes: z.array(z.string().max(40)).max(10).optional(),
  /** Library (collection folder) names, compared without case. */
  libraries: z.array(z.string().max(120)).max(30).optional(),
  /** Item file path prefixes. Needs the `itemPath` permission. */
  pathPrefixes: z.array(z.string().max(300)).max(30).optional(),
});
export type When = z.infer<typeof whenSchema>;

const itemActionSchema = z.object({
  id,
  title: label,
  icon: z.string().max(60).optional(),
  destructive: z.boolean().optional(),
  when: whenSchema.optional(),
  confirm: confirmSchema.optional(),
  inputs: z.array(inputSchema).max(5).optional(),
  request: requestSchema,
});
export type ItemActionSpec = z.infer<typeof itemActionSchema>;

const homeSectionSchema = z.object({
  id,
  title: label,
  /** A JSON feed: `{ "items": [...] }` (see docs/extensions.md). */
  feed: path,
  /** Fetch the feed again after this many seconds (5 or more). */
  refreshSeconds: z.number().int().min(5).max(3600).optional(),
  shape: z.enum(['poster', 'thumb', 'square']).default('thumb'),
});
export type HomeSectionSpec = z.infer<typeof homeSectionSchema>;

const shareTargetSchema = z.object({
  id,
  title: label,
  /** Host names the link must have ("youtube.com" also matches "www.youtube.com"). Empty: any http(s) link. */
  hosts: z.array(z.string().max(120)).max(50).optional(),
  inputs: z.array(inputSchema).max(5).optional(),
  request: requestSchema,
});
export type ShareTargetSpec = z.infer<typeof shareTargetSchema>;

const panelSchema = z.object({
  id,
  title: label,
  icon: z.string().max(60).optional(),
  /** A page under `baseUrl`. It is a template, so it can carry `{{settings.x}}` in the fragment. */
  url: path,
});
export type PanelSpec = z.infer<typeof panelSchema>;

export const manifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  name: label,
  version: z.string().min(1).max(40),
  description: text.optional(),
  /** Every request goes to this origin and to no other. */
  baseUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'The base URL must use http or https'),
  icon: z.string().max(60).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default(['network']),
  /** Headers sent with every request. Values are templates (for example `Bearer {{settings.apiKey}}`). */
  headers: z.record(z.string().max(500)).optional(),
  contributes: z
    .object({
      settings: z.array(settingSchema).max(20).optional(),
      itemActions: z.array(itemActionSchema).max(20).optional(),
      homeSections: z.array(homeSectionSchema).max(5).optional(),
      shareTargets: z.array(shareTargetSchema).max(10).optional(),
      panels: z.array(panelSchema).max(5).optional(),
    })
    .default({}),
});
export type Manifest = z.infer<typeof manifestSchema>;

export type ParseResult = { ok: true; manifest: Manifest } | { ok: false; error: string };

/** Validates a manifest. The error names the first field that is wrong. */
export function parseManifest(data: unknown): ParseResult {
  if (data && typeof data === 'object' && 'schemaVersion' in data && (data as { schemaVersion: unknown }).schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `This app reads manifest schema version ${SCHEMA_VERSION}. The manifest has version ${String((data as { schemaVersion: unknown }).schemaVersion)}.` };
  }
  const r = manifestSchema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? issue.path.join('.') : 'manifest';
    return { ok: false, error: `${where}: ${issue?.message ?? 'not valid'}` };
  }
  const m = r.data;
  // Ids must be unique inside each list, so a contribution has one stable key.
  for (const [name, list] of Object.entries(m.contributes) as [string, { id?: string; key?: string }[] | undefined][]) {
    const keys = (list ?? []).map((e) => e.id ?? e.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) return { ok: false, error: `contributes.${name}: the id "${dup}" is used twice` };
  }
  if (!m.permissions.includes('network')) m.permissions = ['network', ...m.permissions];
  return { ok: true, manifest: m };
}

/** Permissions in the words the install screen shows. */
export function describePermission(p: Permission, m: Pick<Manifest, 'name' | 'baseUrl'>): { title: string; detail: string; sensitive: boolean } {
  const host = safeHost(m.baseUrl);
  switch (p) {
    case 'network':
      return { title: `Connect to ${host}`, detail: `${m.name} receives the requests of its own buttons and rows. The app sends nothing to other addresses.`, sensitive: false };
    case 'itemPath':
      return { title: 'Read file paths', detail: `${m.name} receives the file path on the server of the items you use it on.`, sensitive: false };
    case 'jellyfinToken':
      return {
        title: `${m.name} can act as you on your Jellyfin server`,
        detail: `The app sends your sign-in token and the server address with each request to ${host}. With the token, ${m.name} can do all that you can do on the server. Allow this only for an extension that you trust.`,
        sensitive: true,
      };
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
