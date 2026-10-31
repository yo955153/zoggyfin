import { LIVE_RESTART_LIMIT, LIVE_RESTART_WINDOW_MS, nextLiveRestart } from '../live-restart';

describe('nextLiveRestart', () => {
  it('allows a few restarts, then shows the error', () => {
    let r = null;
    for (let i = 0; i < LIVE_RESTART_LIMIT; i++) {
      r = nextLiveRestart(r, 'p:1', 1000 + i);
      expect(r).not.toBeNull();
    }
    expect(nextLiveRestart(r, 'p:1', 2000)).toBeNull();
  });

  it('forgets restarts that are older than the window', () => {
    let r = null;
    for (let i = 0; i < LIVE_RESTART_LIMIT; i++) r = nextLiveRestart(r, 'p:1', i);
    expect(nextLiveRestart(r, 'p:1', LIVE_RESTART_WINDOW_MS + 10)?.times).toHaveLength(1);
  });

  it('counts again for another channel', () => {
    let r = null;
    for (let i = 0; i < LIVE_RESTART_LIMIT; i++) r = nextLiveRestart(r, 'p:1', i);
    expect(nextLiveRestart(r, 'p:2', 10)).toEqual({ key: 'p:2', times: [10] });
  });
});
