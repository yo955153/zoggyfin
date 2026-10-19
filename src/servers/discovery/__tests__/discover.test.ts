import type { DiscoveryBackend } from '../backend-types';
import { hostsToScan, MAX_HOSTS, runDiscovery } from '../discover';

const ID = '0123456789abcdef0123456789abcdef';

function backend(over: Partial<DiscoveryBackend>): DiscoveryBackend {
  return {
    available: true,
    asksLanAccess: false,
    udpSupported: false,
    udp: async () => ({ answers: [], blocked: false }),
    interfaces: async () => [],
    lanAccess: async () => 'unknown',
    vpnActive: async () => false,
    openSettings: async () => undefined,
    fetchJson: async () => {
      throw new Error('no');
    },
    ...over,
  };
}

describe('hostsToScan', () => {
  it('scans the interfaces in order, without duplicates, at most a /22', () => {
    const hosts = hostsToScan([
      { address: '10.0.0.10', netmask: '255.255.255.0' },
      { address: '10.0.0.11', prefix: 24 },
      { address: '172.16.0.1', prefix: 20 },
    ]);
    expect(hosts).toHaveLength(MAX_HOSTS);
    expect(hosts[0]).toBe('10.0.0.9');
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(hosts).not.toContain('10.0.0.10');
    expect(hosts).not.toContain('10.0.0.11');
  });
  it('skips invalid and public interfaces', () => {
    expect(hostsToScan([{ address: '192.0.2.1', prefix: 24 }, { address: 'x' }])).toEqual([]);
  });
});

describe('runDiscovery', () => {
  it('merges UDP and scan results by Id and keeps the UDP address', async () => {
    const seen: number[] = [];
    const b = backend({
      udpSupported: true,
      udp: async () => ({ answers: [`{"Address":"http://10.0.0.5:8096","Id":"${ID}","Name":"Home"}`, 'junk'], blocked: false }),
      interfaces: async () => [{ address: '10.0.0.4', prefix: 29 }],
      fetchJson: async (url) => {
        if (url.startsWith('http://10.0.0.5:8096') || url.startsWith('http://10.0.0.6:8096'))
          return { ProductName: 'Jellyfin Server', Id: ID, ServerName: 'Home', Version: '10.11.0' };
        throw new Error('refused');
      },
    });
    const r = await runDiscovery(b, { signal: new AbortController().signal, onServers: (s) => seen.push(s.length) });
    expect(r.servers).toEqual([{ id: ID, name: 'Home', version: '10.11.0', address: 'http://10.0.0.5:8096', source: 'udp' }]);
    expect(r.lan).toBe('granted');
    expect(seen.every((n) => n === 1)).toBe(true);
  });

  it('reports denied when the system refused the broadcast', async () => {
    const b = backend({ udpSupported: true, udp: async () => ({ answers: [], blocked: true }) });
    expect((await runDiscovery(b, { signal: new AbortController().signal, onServers: () => undefined })).lan).toBe('denied');
  });

  it('gives nothing after a cancel', async () => {
    const ctl = new AbortController();
    const onServers = jest.fn();
    const b = backend({
      interfaces: async () => [{ address: '10.0.0.4', prefix: 24 }],
      fetchJson: (url, ms, signal) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve({ ProductName: 'Jellyfin Server', Id: ID }), 50);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        }),
    });
    const p = runDiscovery(b, { signal: ctl.signal, onServers });
    setTimeout(() => ctl.abort(), 5);
    const r = await p;
    expect(r.aborted).toBe(true);
    expect(onServers).not.toHaveBeenCalled();
  });
});
