import { qrRows } from '@/features/invite/invite-qr';

describe('qrRows', () => {
  it('draws a QR code with finder patterns for an invite link', () => {
    const m = qrRows(`https://zoggyfin.zog-tech.com/join#${'A'.repeat(300)}`);
    expect(m.count).toBeGreaterThanOrEqual(21);
    expect(m.rows).toHaveLength(m.count);
    // The top-left finder pattern: a dark run of 7 modules in row 0.
    expect(m.rows[0][0]).toEqual([0, 7]);
  });
});
