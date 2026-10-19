import { serverUrlCandidates } from '@/api/server-url';

import { addressNetwork, guessKind } from '../addresses';

describe('addressNetwork', () => {
  it('knows Tailscale addresses and MagicDNS names', () => {
    for (const u of ['http://100.64.0.1:8096', 'http://100.101.2.3', 'http://100.127.255.254', 'https://nas.tail1234.ts.net', 'http://[fd7a:115c:a1e0::1]:8096']) {
      expect(addressNetwork(u)).toBe('tailscale');
    }
  });
  it('does not call addresses next to the Tailscale range Tailscale', () => {
    expect(addressNetwork('http://100.63.255.255')).toBe('internet');
    expect(addressNetwork('http://100.128.0.1')).toBe('internet');
    expect(addressNetwork('https://ts.net.example.com')).toBe('internet');
  });
  it('calls private addresses and local names home network', () => {
    for (const u of ['http://10.0.0.5:8096', 'http://10.8.0.1', 'http://172.16.0.2', 'http://jellyfin.local', 'http://nas:8096']) {
      expect(addressNetwork(u)).toBe('home');
    }
  });
  it('calls public addresses internet', () => {
    expect(addressNetwork('https://media.example.com')).toBe('internet');
    expect(addressNetwork('http://203.0.113.7:8096')).toBe('internet');
  });
});

describe('guessKind with Tailscale', () => {
  it('saves Tailscale addresses as external: they work away from home', () => {
    expect(guessKind('http://100.101.2.3:8096')).toBe('external');
    expect(guessKind('https://nas.tail1234.ts.net')).toBe('external');
  });
});

describe('manual Add server with Tailscale and WireGuard addresses', () => {
  it('makes candidates for a Tailscale IP, a ts.net name and a WireGuard IP', () => {
    expect(serverUrlCandidates('100.101.2.3:8096')).toEqual(['https://100.101.2.3:8096', 'http://100.101.2.3:8096']);
    expect(serverUrlCandidates('nas.tail1234.ts.net')).toEqual(['https://nas.tail1234.ts.net', 'http://nas.tail1234.ts.net']);
    expect(serverUrlCandidates('http://10.8.0.1:8096')).toEqual(['http://10.8.0.1:8096']);
  });
});
