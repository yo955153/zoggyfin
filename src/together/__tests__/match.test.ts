import { matchesShared } from '../match';

const done = { itemId: 'i1', serverId: 's1', state: 'completed' };

describe('matchesShared', () => {
  it('matches the same item of the same server', () => {
    expect(matchesShared(done, { id: 'i1', serverId: 's1' })).toBe(true);
  });

  it('does not match another server', () => {
    expect(matchesShared(done, { id: 'i1', serverId: 's2' })).toBe(false);
  });

  it('falls back to the item Id when a server Id is unknown', () => {
    expect(matchesShared(done, { id: 'i1', serverId: null })).toBe(true);
    expect(matchesShared({ ...done, serverId: '' }, { id: 'i1', serverId: 's2' })).toBe(true);
    expect(matchesShared(done, { id: 'i1' })).toBe(true);
  });

  it('needs a completed download of the same item', () => {
    expect(matchesShared({ ...done, state: 'downloading' }, { id: 'i1', serverId: 's1' })).toBe(false);
    expect(matchesShared(done, { id: 'i2', serverId: 's1' })).toBe(false);
    expect(matchesShared(null, { id: 'i1' })).toBe(false);
  });
});
