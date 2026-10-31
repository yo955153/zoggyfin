/**
 * Programme times for Live TV: "20:30", "20:30–21:15", "25 min left".
 * 24-hour clock (the guide's own times, in the device's time zone).
 * Pure, so it is unit-tested.
 */

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function timeRange(start: number, stop: number): string {
  return `${clock(start)}–${clock(stop)}`;
}

/** The time left of a programme: "25 min left", "1 h 5 min left", "Ending" in the last minute. */
export function timeLeft(stop: number, now: number): string {
  const min = Math.ceil((stop - now) / 60_000);
  if (min <= 1) return 'Ending';
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min left` : `${h} h left`;
}
