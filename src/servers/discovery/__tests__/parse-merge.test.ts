import { isSaved, mergeAll, mergeServer, sortForList } from '../merge';
import { cleanAddress, parsePublicInfo, parseUdpAnswer } from '../parse';
import type { DiscoveredServer } from '../types';

const ID = '0123456789abcdef0123456789abcdef';

describe('parseUdpAnswer', () => {
  it('reads a valid answer', () => {
    expect(parseUdpAnswer(`{"Address":"http://192.0.2.10:8096/","Id":"${ID}","Name":"Home","EndpointAddress":null}`)).toEqual({
      id: ID,
      name: 'Home',
      version: null,
      address: 'http://192.0.2.10:8096',
      source: 'udp',
    });
  });
  it('rejects bad answers', () => {
    expect(parseUdpAnswer('not json')).toBeNull();
    expect(parseUdpAnswer('[]')).toBeNull();
    expect(parseUdpAnswer('{"Address":"http://192.0.2.10:8096"}')).toBeNull();
    expect(parseUdpAnswer(`{"Address":"ftp://192.0.2.10","Id":"${ID}"}`)).toBeNull();
    expect(parseUdpAnswer(`{"Address":42,"Id":"${ID}"}`)).toBeNull();
    expect(parseUdpAnswer(null)).toBeNull();
  });
  it('gives a default name', () => {
    expect(parseUdpAnswer({ Address: 'http://192.0.2.10:8096', Id: ID })!.name).toBe('Jellyfin');
  });
});

describe('parsePublicInfo', () => {
  it('accepts only Jellyfin', () => {
    const info = { ProductName: 'Jellyfin Server', Id: ID, ServerName: 'Den', Version: '10.11.0' };
    expect(parsePublicInfo('http://192.0.2.11:8096', info)).toEqual({
      id: ID,
      name: 'Den',
      version: '10.11.0',
      address: 'http://192.0.2.11:8096',
      source: 'scan',
    });
    expect(parsePublicInfo('http://192.0.2.11:8096', { ...info, ProductName: 'Emby Server' })).toBeNull();
    expect(parsePublicInfo('http://192.0.2.11:8096', { ...info, Id: '' })).toBeNull();
    expect(parsePublicInfo('http://192.0.2.11:8096', '<html>')).toBeNull();
    expect(parsePublicInfo('not a url', info)).toBeNull();
  });
});

describe('cleanAddress', () => {
  it('keeps http(s) URLs without a trailing slash', () => {
    expect(cleanAddress('https://jf.example.com/jellyfin/')).toBe('https://jf.example.com/jellyfin');
    expect(cleanAddress('javascript:alert(1)')).toBeNull();
  });
});

const udp: DiscoveredServer = { id: ID, name: 'Home', version: null, address: 'http://192.0.2.10:8096', source: 'udp' };
const scan: DiscoveredServer = { id: ID.toUpperCase(), name: 'Home', version: '10.11.0', address: 'http://192.0.2.99:8096', source: 'scan' };
const other: DiscoveredServer = { id: 'ffff', name: 'Attic', version: '12.0.0', address: 'http://192.0.2.20:8096', source: 'scan' };

describe('mergeServer', () => {
  it('keeps one entry per Id and prefers the UDP address', () => {
    expect(mergeAll([], [udp, scan])).toEqual([{ ...udp, version: '10.11.0' }]);
    expect(mergeAll([], [scan, udp])).toEqual([{ ...udp, version: '10.11.0' }]);
  });
  it('compares Ids with and without dashes', () => {
    const dashed = { ...scan, id: '01234567-89ab-cdef-0123-456789abcdef' };
    expect(mergeAll([udp], [dashed])).toHaveLength(1);
  });
  it('returns the same array when nothing changes', () => {
    const list = [udp];
    expect(mergeServer(list, udp)).toBe(list);
  });
  it('adds new servers', () => {
    expect(mergeAll([udp], [other])).toHaveLength(2);
  });
});

describe('saved servers', () => {
  it('marks and sorts', () => {
    expect(isSaved(udp, ['01234567-89AB-CDEF-0123-456789ABCDEF'])).toBe(true);
    expect(isSaved(other, [ID])).toBe(false);
    expect(sortForList([udp, other], [ID]).map((s) => s.name)).toEqual(['Attic', 'Home']);
  });
});
