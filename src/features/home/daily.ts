/**
 * Choices that stay the same for one user for one local day: the order of
 * "Short on time" and the genre of the day. A seed from the date and the
 * user Id drives a small seeded random generator, so a refetch, a cold
 * start or a second device gives the same result until midnight. Pure, so
 * it is unit-tested.
 */

/** The local date as "YYYY-MM-DD". It changes at local midnight. */
export function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/** A 32-bit FNV-1a hash of a string. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: a small seeded generator of numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of `list` in an order fixed by `seed` (Fisher-Yates). */
export function seededShuffle<T>(list: readonly T[], seed: string): T[] {
  const out = [...list];
  const rand = seededRandom(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The seed of one user's day. */
export function daySeed(day: string, userId: string): string {
  return `${day}:${userId}`;
}
