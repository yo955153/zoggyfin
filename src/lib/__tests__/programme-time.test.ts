import { clock, timeLeft, timeRange } from '../programme-time';

describe('programme times', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 31, h, m).getTime();

  it('shows a 24-hour clock and a range', () => {
    expect(clock(at(9, 5))).toBe('09:05');
    expect(timeRange(at(20, 30), at(21, 15))).toBe('20:30–21:15');
  });

  it('shows the time left in minutes, hours, or Ending', () => {
    expect(timeLeft(at(21, 0), at(20, 35))).toBe('25 min left');
    expect(timeLeft(at(22, 5), at(21, 0))).toBe('1 h 5 min left');
    expect(timeLeft(at(23, 0), at(21, 0))).toBe('2 h left');
    expect(timeLeft(at(21, 0), at(20, 59) + 30_000)).toBe('Ending');
  });
});
