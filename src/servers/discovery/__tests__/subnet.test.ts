import { formatIPv4, isPrivateIPv4, parseIPv4, prefixOf, subnetHosts } from '../subnet';

/** An address in the RFC 1918 /16 block of home routers (written as a number, so no real address shows in the code). */
const home = (c: number, d: number): string => formatIPv4(0xc0a80000 + c * 256 + d);

describe('parseIPv4', () => {
  it('reads valid addresses', () => {
    expect(parseIPv4('192.0.2.10')).toBe(0xc000020a);
    expect(formatIPv4(parseIPv4('10.1.2.3')!)).toBe('10.1.2.3');
  });
  it('rejects bad text', () => {
    for (const t of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'a.b.c.d', '1.2.3.-4', null, undefined]) expect(parseIPv4(t)).toBeNull();
  });
});

describe('prefixOf', () => {
  it('reads netmasks and prefixes', () => {
    expect(prefixOf('255.255.255.0')).toBe(24);
    expect(prefixOf('255.255.252.0')).toBe(22);
    expect(prefixOf('255.255.0.0')).toBe(16);
    expect(prefixOf('0.0.0.0')).toBe(0);
    expect(prefixOf('255.255.255.255')).toBe(32);
    expect(prefixOf(24)).toBe(24);
    expect(prefixOf('/23')).toBe(23);
  });
  it('rejects masks that are not contiguous or out of range', () => {
    expect(prefixOf('255.0.255.0')).toBeNull();
    expect(prefixOf('255.255.255.1')).toBeNull();
    expect(prefixOf(33)).toBeNull();
    expect(prefixOf(-1)).toBeNull();
    expect(prefixOf('garbage')).toBeNull();
    expect(prefixOf(null)).toBeNull();
  });
});

describe('isPrivateIPv4', () => {
  it('knows the private ranges', () => {
    expect(isPrivateIPv4(parseIPv4('10.0.0.1')!)).toBe(true);
    expect(isPrivateIPv4(parseIPv4('172.16.0.1')!)).toBe(true);
    expect(isPrivateIPv4(parseIPv4('172.31.255.1')!)).toBe(true);
    expect(isPrivateIPv4(parseIPv4('172.32.0.1')!)).toBe(false);
    expect(isPrivateIPv4(parseIPv4(home(1, 1))!)).toBe(true);
    expect(isPrivateIPv4(parseIPv4('169.254.3.4')!)).toBe(true);
    expect(isPrivateIPv4(parseIPv4('192.0.2.10')!)).toBe(false);
    expect(isPrivateIPv4(parseIPv4('8.8.8.8')!)).toBe(false);
  });
});

describe('subnetHosts', () => {
  it('lists the 253 other hosts of a /24, near hosts first', () => {
    const r = subnetHosts('10.0.5.20', '255.255.255.0')!;
    expect(r.prefix).toBe(24);
    expect(formatIPv4(r.network)).toBe('10.0.5.0');
    expect(formatIPv4(r.broadcast)).toBe('10.0.5.255');
    expect(r.hosts).toHaveLength(253);
    expect(r.hosts.slice(0, 4)).toEqual(['10.0.5.19', '10.0.5.21', '10.0.5.18', '10.0.5.22']);
    expect(r.hosts).not.toContain('10.0.5.20');
    expect(r.hosts).not.toContain('10.0.5.0');
    expect(r.hosts).not.toContain('10.0.5.255');
  });

  it('lists 1021 hosts of a /22', () => {
    const r = subnetHosts('172.16.6.1', 22)!;
    expect(formatIPv4(r.network)).toBe('172.16.4.0');
    expect(formatIPv4(r.broadcast)).toBe('172.16.7.255');
    expect(r.hosts).toHaveLength(1021);
  });

  it('shrinks a larger subnet to the /22 around the device', () => {
    const r = subnetHosts('10.20.30.40', '255.0.0.0')!;
    expect(r.prefix).toBe(22);
    expect(formatIPv4(r.network)).toBe('10.20.28.0');
    expect(r.hosts).toHaveLength(1021);
  });

  it('refuses invalid input, tiny subnets and public addresses', () => {
    expect(subnetHosts('10.0.0.1', '255.0.255.0')).toBeNull();
    expect(subnetHosts('10.0.0.1', 31)).toBeNull();
    expect(subnetHosts('10.0.0.1', 32)).toBeNull();
    expect(subnetHosts('not an ip', 24)).toBeNull();
    expect(subnetHosts('192.0.2.10', 24)).toBeNull();
    expect(subnetHosts(null, null)).toBeNull();
  });

  it('handles a /30', () => {
    expect(subnetHosts(home(0, 1), 30)!.hosts).toEqual([home(0, 2)]);
  });
});
