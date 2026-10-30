import { isShortPick, shortOnTime } from '../short-on-time';
import { item } from '../test-utils/items';

const min = (m: number) => m * 600_000_000;

describe('short on time', () => {
  it('keeps unwatched movies from 10 to 100 minutes', () => {
    expect(isShortPick(item('a', { RunTimeTicks: min(95) }))).toBe(true);
    expect(isShortPick(item('a', { RunTimeTicks: min(100) }))).toBe(true);
    expect(isShortPick(item('a', { RunTimeTicks: min(10) }))).toBe(true);
    expect(isShortPick(item('a', { RunTimeTicks: min(101) }))).toBe(false);
    expect(isShortPick(item('a', { RunTimeTicks: min(5) }))).toBe(false);
  });

  it('drops movies with no runtime, no Id, or that the user played or started', () => {
    expect(isShortPick(item('a'))).toBe(false);
    expect(isShortPick({ RunTimeTicks: min(90) })).toBe(false);
    expect(isShortPick(item('a', { RunTimeTicks: min(90) }, { Played: true }))).toBe(false);
    expect(isShortPick(item('a', { RunTimeTicks: min(90) }, { PlaybackPositionTicks: min(3) }))).toBe(false);
    expect(isShortPick(item('a', { RunTimeTicks: min(90) }, { Played: false }))).toBe(true);
  });

  it('keeps the order for one seed and caps the row', () => {
    const pool = Array.from({ length: 40 }, (_, i) => item(`m${i}`, { RunTimeTicks: min(i % 2 ? 90 : 140) }));
    const row = shortOnTime(pool, '2026-10-30:user1', 10);
    expect(row).toHaveLength(10);
    expect(row.every((it) => it.RunTimeTicks === min(90))).toBe(true);
    expect(shortOnTime(pool, '2026-10-30:user1', 10)).toEqual(row);
    expect(shortOnTime(pool, '2026-10-31:user1', 10).map((i) => i.Id)).not.toEqual(row.map((i) => i.Id));
  });

  it('gives nothing for no pool', () => {
    expect(shortOnTime(undefined, 'x')).toEqual([]);
    expect(shortOnTime([item('a', { RunTimeTicks: min(150) })], 'x')).toEqual([]);
  });
});
