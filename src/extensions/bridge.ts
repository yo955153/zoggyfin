/**
 * The panel bridge. A panel page sends
 * `{ zoggyfin: 1, id, method, params }` with postMessage; the app answers
 * `{ zoggyfin: 1, id, result }` or `{ zoggyfin: 1, id, error }`. These six
 * methods are all a panel can do in the app.
 */

export const BRIDGE_METHODS = ['getContext', 'play', 'openItem', 'refreshLibrary', 'toast', 'close'] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

export interface BridgeRequest {
  id: number | string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

export interface BridgeReply {
  zoggyfin: 1;
  id: number | string;
  result?: unknown;
  error?: string;
}

export interface BridgeDeps {
  context(): unknown;
  play(itemId: string): Promise<void> | void;
  openItem(itemId: string): Promise<void> | void;
  refreshLibrary(): void;
  toast(text: string): void;
  close(): void;
}

/** Reads a message (an object or a JSON string). Returns null for anything that is not a bridge request. */
export function readBridgeMessage(raw: unknown): BridgeRequest | null {
  let data = raw;
  if (typeof raw === 'string') {
    if (raw.length > 10_000) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as { zoggyfin?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (d.zoggyfin !== 1) return null;
  if (typeof d.id !== 'number' && typeof d.id !== 'string') return null;
  if (typeof d.method !== 'string' || !(BRIDGE_METHODS as readonly string[]).includes(d.method)) return null;
  const params = d.params && typeof d.params === 'object' && !Array.isArray(d.params) ? (d.params as Record<string, unknown>) : {};
  return { id: d.id, method: d.method as BridgeMethod, params };
}

/** True when a message comes from the extension's own origin. */
export function sameOrigin(url: string | null | undefined, baseUrl: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

const idParam = (p: Record<string, unknown>) => {
  const v = p.itemId;
  if (typeof v !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(v)) throw new Error('itemId is not valid');
  return v;
};

/** Runs one request and builds the reply. */
export async function handleBridgeRequest(req: BridgeRequest, deps: BridgeDeps): Promise<BridgeReply> {
  try {
    let result: unknown = true;
    switch (req.method) {
      case 'getContext':
        result = deps.context();
        break;
      case 'play':
        await deps.play(idParam(req.params));
        break;
      case 'openItem':
        await deps.openItem(idParam(req.params));
        break;
      case 'refreshLibrary':
        deps.refreshLibrary();
        break;
      case 'toast': {
        const text = req.params.text;
        if (typeof text !== 'string' || !text.trim()) throw new Error('text is required');
        deps.toast(text.slice(0, 200));
        break;
      }
      case 'close':
        deps.close();
        break;
    }
    return { zoggyfin: 1, id: req.id, result };
  } catch (e) {
    return { zoggyfin: 1, id: req.id, error: e instanceof Error ? e.message : 'Failed' };
  }
}
