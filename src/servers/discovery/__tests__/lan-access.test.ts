import { inferLanAccess, isPrivateAddress, lanHelpFor, withLanRetry } from '../lan-access';
import { formatIPv4 } from '../subnet';
/** An address in the RFC 1918 /16 block of home routers (written as a number, so no real address shows in the code). */
const home = (c: number, d: number): string => formatIPv4(0xc0a80000 + c * 256 + d);

const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const authError = Object.assign(new Error('Unauthorized'), { response: { status: 401 } });

describe('isPrivateAddress', () => {
  it('knows private ranges and .local names', () => {
    for (const a of ['http://10.0.0.5:8096', '172.16.1.1:8096', 'http://172.31.0.1', `https://${home(1, 2)}`, 'jellyfin.local', 'http://nas.local:8096/jf']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ['https://jf.example.com', 'http://100.64.1.2:8096', 'https://box.example.ts.net', 'http://192.0.2.10:8096', 'http://172.32.0.1', 'http://8.8.8.8', '', 'local']) {
      expect(isPrivateAddress(a)).toBe(false);
    }
  });
});

describe('withLanRetry', () => {
  const noSleep = { sleep: async () => undefined };

  it('retries a private address once after a network error', async () => {
    const fn = jest.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce('ok');
    const sleep = jest.fn(async () => undefined);
    await expect(withLanRetry(`http://${home(1, 2)}:8096`, fn, { sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it('retries only once', async () => {
    const fn = jest.fn().mockRejectedValue(networkError);
    await expect(withLanRetry('http://10.0.0.2', fn, noSleep)).rejects.toBe(networkError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a Tailscale address', async () => {
    const fn = jest.fn().mockRejectedValue(networkError);
    await expect(withLanRetry('http://100.64.0.7:8096', fn, noSleep)).rejects.toBe(networkError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a public address or another error', async () => {
    const a = jest.fn().mockRejectedValue(networkError);
    await expect(withLanRetry('https://jf.example.com', a, noSleep)).rejects.toBe(networkError);
    expect(a).toHaveBeenCalledTimes(1);
    const b = jest.fn().mockRejectedValue(authError);
    await expect(withLanRetry('http://10.0.0.2', b, noSleep)).rejects.toBe(authError);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not retry after a cancel', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const fn = jest.fn().mockRejectedValue(networkError);
    await expect(withLanRetry('http://10.0.0.2', fn, { ...noSleep, signal: ctl.signal })).rejects.toBe(networkError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('lanHelpFor', () => {
  it('shows the local network help for a network error to a private address on a platform that asks', () => {
    expect(lanHelpFor(`http://${home(1, 2)}:8096`, networkError, true)).toBe('lan-access');
    expect(lanHelpFor(`http://${home(1, 2)}:8096`, networkError, false)).toBeNull();
    expect(lanHelpFor('https://jf.example.com', networkError, true)).toBeNull();
    expect(lanHelpFor(`http://${home(1, 2)}:8096`, authError, true)).toBeNull();
  });
  it('names Tailscale for a Tailscale address', () => {
    expect(lanHelpFor('http://100.101.102.103:8096', networkError, true)).toBe('tailscale');
    expect(lanHelpFor('https://nas.example.ts.net', networkError, false)).toBe('tailscale');
    expect(lanHelpFor('http://100.101.102.103:8096', authError, true)).toBeNull();
  });
  it('mentions the VPN for a 10.x address while a VPN is up', () => {
    expect(lanHelpFor('http://10.8.0.1:8096', networkError, true, true)).toBe('lan-access-vpn');
    expect(lanHelpFor('http://10.8.0.1:8096', networkError, false, true)).toBe('vpn');
    expect(lanHelpFor(`http://${home(1, 2)}:8096`, networkError, true, true)).toBe('lan-access');
    expect(lanHelpFor(`http://${home(1, 2)}:8096`, networkError, false, true)).toBeNull();
  });
});

describe('inferLanAccess', () => {
  const base = { native: 'unknown' as const, lanAnswered: false, fastFailures: 0, finished: 0 };
  it('decides from the evidence', () => {
    expect(inferLanAccess({ ...base, lanAnswered: true, native: 'denied' })).toBe('granted');
    expect(inferLanAccess({ ...base, native: 'denied' })).toBe('denied');
    expect(inferLanAccess({ ...base, native: 'granted' })).toBe('granted');
    expect(inferLanAccess({ ...base, fastFailures: 95, finished: 100 })).toBe('denied');
    expect(inferLanAccess({ ...base, fastFailures: 10, finished: 100 })).toBe('unknown');
    expect(inferLanAccess({ ...base, fastFailures: 5, finished: 5 })).toBe('unknown');
  });
});
