import { classifyAddress, hasVpnInterface, hostOf, isTenNet } from '../address-class';
import { formatIPv4 } from '../discovery/subnet';
/** An address in the RFC 1918 /16 block of home routers (written as a number, so no real address shows in the code). */
const home = (c: number, d: number): string => formatIPv4(0xc0a80000 + c * 256 + d);

describe('classifyAddress', () => {
  it('knows the local network', () => {
    for (const a of ['http://10.1.2.3:8096', '172.16.0.9', 'https://172.31.255.1', `http://${home(0, 2)}/jf`, 'nas.local', 'http://169.254.1.1', 'http://[fd12::1]:8096']) {
      expect(classifyAddress(a)).toBe('lan');
    }
  });
  it('treats Tailscale as a VPN, not the local network', () => {
    for (const a of ['http://100.64.0.1:8096', '100.100.100.100', 'http://100.127.255.254', 'https://nas.tailnet-1234.ts.net', 'http://[fd7a:115c:a1e0::1]:8096']) {
      expect(classifyAddress(a)).toBe('tailscale');
    }
    expect(classifyAddress('http://100.63.255.255')).toBe('public');
    expect(classifyAddress('http://100.128.0.1')).toBe('public');
  });
  it('knows loopback and public', () => {
    expect(classifyAddress('http://localhost:8096')).toBe('loopback');
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('https://jellyfin.example.com')).toBe('public');
    expect(classifyAddress('http://192.0.2.10:8096')).toBe('public');
    expect(classifyAddress('')).toBe('public');
  });
});

describe('helpers', () => {
  it('reads hosts', () => {
    expect(hostOf('https://user@Host.Example.com:8920/x')).toBe('host.example.com');
    expect(hostOf('[fd00::1]:80')).toBe('fd00::1');
  });
  it('knows 10/8', () => {
    expect(isTenNet('http://10.8.0.2:8096')).toBe(true);
    expect(isTenNet(`http://${home(1, 1)}`)).toBe(false);
  });
  it('finds VPN tunnels with IPv4 addresses', () => {
    expect(hasVpnInterface([{ name: 'en0', address: '10.0.0.2' }])).toBe(false);
    expect(hasVpnInterface([{ name: 'utun3', address: 'fe80::1' }])).toBe(false);
    expect(hasVpnInterface([{ name: 'utun4', address: '10.8.0.2' }])).toBe(true);
    expect(hasVpnInterface([{ name: 'wg0', address: '10.7.0.3' }])).toBe(true);
    expect(hasVpnInterface([{ address: '10.7.0.3' }])).toBe(false);
  });
});
