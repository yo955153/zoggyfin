import { popInStep } from '@/lib/pop-in';

import { downloadFinished } from '../download-arrival';

describe('downloadFinished', () => {
  it('counts a running download that completes', () => {
    expect(downloadFinished('downloading', 'completed')).toBe(true);
    expect(downloadFinished('queued', 'completed')).toBe(true);
  });
  it('ignores other changes', () => {
    expect(downloadFinished('none', 'completed')).toBe(false);
    expect(downloadFinished('paused', 'completed')).toBe(false);
    expect(downloadFinished('completed', 'none')).toBe(false);
    expect(downloadFinished('queued', 'downloading')).toBe(false);
  });
  it('plays only for the same item, never on mount', () => {
    expect(popInStep(null, { scope: 'a', value: 'completed' }, downloadFinished)).toBe('none');
    expect(popInStep({ scope: 'a', value: 'downloading' }, { scope: 'a', value: 'completed' }, downloadFinished)).toBe('play');
    expect(popInStep({ scope: 'a', value: 'downloading' }, { scope: 'b', value: 'completed' }, downloadFinished)).toBe('rest');
  });
});
