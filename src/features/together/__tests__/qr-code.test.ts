import { qrRuns } from '../qr-code';

describe('qrRuns', () => {
  it('gives a 21-module matrix (version 1) for a short value', () => {
    const m = qrRuns('HELLO');
    expect(m.count).toBe(21);
    expect(m.rows).toHaveLength(21);
  });

  it('merges dark modules into runs', () => {
    const m = qrRuns('HELLO');
    // Row 0 starts with the 7-module finder pattern, and ends with one too.
    expect(m.rows[0][0]).toEqual([0, 7]);
    expect(m.rows[0][m.rows[0].length - 1]).toEqual([14, 7]);
    for (const runs of m.rows) {
      for (let i = 1; i < runs.length; i++) {
        // Two runs never touch: a gap of at least one light module.
        expect(runs[i][0]).toBeGreaterThan(runs[i - 1][0] + runs[i - 1][1]);
      }
    }
  });

  it('grows for a join link and reads non-ASCII text', () => {
    const m = qrRuns('zoggyfin://join?v=1&a=172.20.1.4,10.0.0.2&p=50123&s=1a2b3c4d&k=0123456789abcdef0123&n=Sam%E2%80%99s');
    expect(m.count).toBeGreaterThan(21);
    expect(qrRuns('WIFI:T:WPA;S:Café;P:x;;').count).toBeGreaterThanOrEqual(21);
  });
});
