/**
 * Home row feeds. A feed is `{ "items": [...] }`; each entry is a Jellyfin
 * item (`itemId`) or a plain card (title, subtitle, image, progress, and a
 * link, a panel or an item to open).
 */
import { z } from 'zod';

import { resolveOnOrigin } from './match';

const entrySchema = z
  .object({
    id: z.string().max(200).optional(),
    itemId: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(200).optional(),
    image: z.string().max(1000).optional(),
    /** 0 to 1: a bar on the card. */
    progress: z.number().min(0).max(1).optional(),
    /** An http(s) page to open in the browser. */
    link: z.string().max(1000).optional(),
    /** The id of one of the extension's panels to open. */
    panel: z.string().max(64).optional(),
  })
  .refine((e) => !!e.itemId || !!e.title, 'An entry needs an itemId or a title');

export const feedSchema = z.object({ items: z.array(z.unknown()).max(100) });

export type FeedEntry = z.infer<typeof entrySchema> & { key: string; imageUrl?: string };

/**
 * Reads a feed. Entries that are not valid are left out (one bad entry does
 * not hide the row). Card images must be on the extension's origin.
 */
export function parseFeed(data: unknown, baseUrl: string): FeedEntry[] {
  const r = feedSchema.safeParse(data);
  if (!r.success) throw new Error('The feed is not in the expected format.');
  const out: FeedEntry[] = [];
  r.data.items.forEach((raw, i) => {
    const e = entrySchema.safeParse(raw);
    if (!e.success) return;
    let imageUrl: string | undefined;
    if (e.data.image) {
      try {
        imageUrl = resolveOnOrigin(baseUrl, e.data.image).toString();
      } catch {
        imageUrl = undefined;
      }
    }
    const link = e.data.link && /^https?:\/\//i.test(e.data.link) ? e.data.link : undefined;
    out.push({ ...e.data, link, imageUrl, key: e.data.id ?? e.data.itemId ?? `${i}` });
  });
  return out;
}
