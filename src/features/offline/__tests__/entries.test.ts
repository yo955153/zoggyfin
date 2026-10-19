import { completedCount, NO_ENTRIES, offlineEntries } from '../entries';

describe('offlineEntries', () => {
  it('no accounts and no downloads: only the nearby join, where the module exists', () => {
    expect(offlineEntries({ signedIn: false, serverReachable: null, downloads: 0, nearby: true })).toEqual({ downloads: false, joinNearby: true, hostNearby: false });
    expect(offlineEntries({ signedIn: false, serverReachable: null, downloads: 0, nearby: false })).toEqual(NO_ENTRIES);
  });

  it('no accounts and downloads: Downloads, join and host', () => {
    expect(offlineEntries({ signedIn: false, serverReachable: null, downloads: 3, nearby: true })).toEqual({ downloads: true, joinNearby: true, hostNearby: true });
    // The web and old builds: Downloads only.
    expect(offlineEntries({ signedIn: false, serverReachable: null, downloads: 3, nearby: false })).toEqual({ downloads: true, joinNearby: false, hostNearby: false });
  });

  it('an account, but the server does not answer: the same entries', () => {
    expect(offlineEntries({ signedIn: true, serverReachable: false, downloads: 2, nearby: true })).toEqual({ downloads: true, joinNearby: true, hostNearby: true });
    expect(offlineEntries({ signedIn: true, serverReachable: false, downloads: 0, nearby: true })).toEqual({ downloads: false, joinNearby: true, hostNearby: false });
  });

  it('an account and the server answers (or is not checked yet): no extra entries', () => {
    expect(offlineEntries({ signedIn: true, serverReachable: true, downloads: 5, nearby: true })).toEqual(NO_ENTRIES);
    expect(offlineEntries({ signedIn: true, serverReachable: null, downloads: 5, nearby: true })).toEqual(NO_ENTRIES);
  });

  it('counts only completed downloads', () => {
    expect(completedCount({ a: { state: 'completed' }, b: { state: 'downloading' }, c: { state: 'completed' } })).toBe(2);
  });
});
