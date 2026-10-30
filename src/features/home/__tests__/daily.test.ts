import { dayKey, daySeed, hashSeed, seededRandom, seededShuffle } from '../daily';

describe('day key', () => {
  it('uses the local date with padding', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 9, 30, 0, 0))).toBe('2026-10-30');
  });

  it('changes at local midnight', () => {
    expect(dayKey(new Date(2026, 9, 30, 23, 59, 59))).not.toBe(dayKey(new Date(2026, 9, 31, 0, 0, 0)));
  });
});

describe('seeded order', () => {
  it('hashes the same text to the same number', () => {
    expect(hashSeed('a')).toBe(hashSeed('a'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });

  it('gives numbers in [0, 1) that repeat for the same seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('shuffles the same way for the same seed and keeps every entry', () => {
    const list = Array.from({ length: 30 }, (_, i) => i);
    const one = seededShuffle(list, daySeed('2026-10-30', 'user1'));
    expect(seededShuffle(list, daySeed('2026-10-30', 'user1'))).toEqual(one);
    expect([...one].sort((x, y) => x - y)).toEqual(list);
    expect(list[0]).toBe(0); // the input stays as it was
  });

  it('gives another order on another day or for another user', () => {
    const list = Array.from({ length: 30 }, (_, i) => i);
    const base = seededShuffle(list, daySeed('2026-10-30', 'user1'));
    expect(seededShuffle(list, daySeed('2026-10-31', 'user1'))).not.toEqual(base);
    expect(seededShuffle(list, daySeed('2026-10-30', 'user2'))).not.toEqual(base);
  });
});
