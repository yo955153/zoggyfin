/**
 * The device key that a guest sends with each join (JoinContext.device), so
 * that the host's block (join-gate.ts) holds for the whole session. The
 * member id is new on each launch, so a blocked guest got in again after a
 * restart.
 *
 * The key is random, one for each session, and it stays in secure storage
 * (the iOS keychain, the Android keystore). The same device sends the same
 * key to the same session after a restart, but a different key to every
 * other session: no host can follow a device from session to session.
 *
 * The session is known by its short id (the advert, the QR code, a
 * reconnect, Bluetooth). A typed short code has no session id: it uses the
 * key prefix of the code (`k:<prefix>`), also one for each session.
 */
import { secureStore } from '@/storage/secure';

const STORE_KEY = 'together.devices.v1';
/** Keys of sessions older than this go, ms. */
export const DEVICE_KEY_TTL = 7 * 24 * 3600_000;
/** At most this many sessions keep a key. */
export const MAX_DEVICE_KEYS = 64;

interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

type Saved = Record<string, { id: string; at: number }>;

/** The device key for a session (`salt`: its short id). Makes and saves one the first time. */
export function sessionDeviceKey(salt: string, random: () => string, deps: { store?: Store; now?: () => number } = {}): string {
  const store = deps.store ?? secureStore;
  const now = (deps.now ?? Date.now)();
  let saved: Saved = {};
  try {
    const raw = store.get(STORE_KEY);
    if (raw) saved = JSON.parse(raw) as Saved;
  } catch {
    saved = {};
  }
  const hit = saved[salt];
  if (hit && typeof hit.id === 'string' && hit.id.length >= 16) {
    hit.at = now;
  } else {
    saved[salt] = { id: random(), at: now };
  }
  const kept = Object.entries(saved)
    .filter(([, v]) => v && typeof v.id === 'string' && now - v.at < DEVICE_KEY_TTL)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_DEVICE_KEYS);
  try {
    store.set(STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // No secure storage: the key holds until the app ends.
  }
  return saved[salt].id;
}
