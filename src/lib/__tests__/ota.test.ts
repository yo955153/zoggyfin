import { otaLabel, versionWithOta } from '../ota';

describe('over-the-air update labels', () => {
  const ota = { id: 'c66a06bb', createdAt: new Date('2026-10-20T21:30:00Z') };

  it('adds the update ID to the version for the server', () => {
    expect(versionWithOta('0.1.0', ota)).toBe('0.1.0+c66a06bb');
    expect(versionWithOta('0.1.0', null)).toBe('0.1.0');
  });

  it('labels the update with its date', () => {
    expect(otaLabel(ota)).toBe('Update c66a06bb, 20 Oct');
    expect(otaLabel({ id: 'c66a06bb', createdAt: null })).toBe('Update c66a06bb');
    expect(otaLabel(null)).toBeNull();
  });
});
