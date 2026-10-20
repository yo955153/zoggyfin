import type { LinkAddress } from '../link-native-types';
import {
  isIpv4,
  joinLink,
  type JoinPayload,
  keyMatches,
  newSessionKey,
  parseJoinLink,
  parseShortCode,
  pickCodeAddress,
  shortCode,
  shortSession,
  wifiQr,
} from '../join-code';

const KEY = '0123456789abcdef0123';
const base: JoinPayload = { v: 1, addrs: ['172.20.1.4', '10.0.0.2'], port: 50123, session: '1a2b3c4d', key: KEY };
const link = (q: string) => `zoggyfin://join?${q}`;
const good = 'v=1&a=172.20.1.4&p=50123&s=1a2b3c4d&k=0123456789abcdef0123';

describe('newSessionKey and shortSession', () => {
  it('makes 20 hex characters from 10 bytes', () => {
    const key = newSessionKey((n) => Uint8Array.from({ length: n }, (_, i) => i * 17));
    expect(key).toBe('00112233445566778899');
  });

  it('throws when random() gives too few bytes', () => {
    expect(() => newSessionKey(() => new Uint8Array(4))).toThrow();
  });

  it('shortens a session id', () => {
    expect(shortSession('1A2B-3C4D-5E6F-7A8B')).toBe('1a2b3c4d');
    expect(shortSession('9f8e7d6c-1111-2222-3333-444455556666')).toBe('9f8e7d6c');
  });
});

describe('isIpv4', () => {
  it.each(['0.0.0.0', '172.20.1.4', '255.255.255.255', '10.0.0.1'])('accepts %s', (a) => {
    expect(isIpv4(a)).toBe(true);
  });
  it.each(['256.1.1.1', '01.2.3.4', '1.2.3', '1.2.3.4.5', '1.2.3.-4', ' 1.2.3.4', '1.2.3.4 ', 'a.b.c.d', '', '1..2.3'])(
    'rejects %p',
    (a) => {
      expect(isIpv4(a)).toBe(false);
    },
  );
});

describe('joinLink and parseJoinLink', () => {
  it('round trips with no name', () => {
    const url = joinLink(base);
    expect(url).toBe('zoggyfin://join?v=1&a=172.20.1.4,10.0.0.2&p=50123&s=1a2b3c4d&k=0123456789abcdef0123');
    expect(parseJoinLink(url)).toEqual(base);
  });

  it('round trips a name with spaces and symbols', () => {
    const p = { ...base, name: 'Sam’s iPad & TV = 1?' };
    const url = joinLink(p);
    expect(url).toContain('&n=');
    expect(parseJoinLink(url)).toEqual(p);
  });

  it('cuts a long name to 30 characters', () => {
    const url = joinLink({ ...base, name: 'x'.repeat(50) });
    expect(parseJoinLink(url)?.name).toBe('x'.repeat(30));
  });

  it('keeps the link at 300 characters or less with 4 addresses and a wide name', () => {
    const p: JoinPayload = {
      ...base,
      addrs: ['255.255.255.255', '255.255.255.254', '255.255.255.253', '255.255.255.252'],
      port: 65535,
      name: '😀'.repeat(30),
    };
    const url = joinLink(p);
    expect(url.length).toBeLessThanOrEqual(300);
    const back = parseJoinLink(url);
    expect(back?.name).toBe('😀'.repeat(Array.from(back?.name ?? '').length));
    expect(Array.from(back?.name ?? '').length).toBeGreaterThan(0);
  });

  it('leaves out an empty name', () => {
    expect(joinLink({ ...base, name: '   ' })).not.toContain('&n=');
    expect(parseJoinLink(link(`${good}&n=`))?.name).toBeUndefined();
  });

  it('throws on an invalid payload (programmer error)', () => {
    expect(() => joinLink({ ...base, addrs: [] })).toThrow();
    expect(() => joinLink({ ...base, port: 0 })).toThrow();
    expect(() => joinLink({ ...base, key: 'abc' })).toThrow();
  });

  it('accepts the triple-slash form of Expo Linking', () => {
    expect(parseJoinLink(`zoggyfin:///join?${good}`)?.port).toBe(50123);
  });

  it('ignores unknown parameters and a fragment', () => {
    expect(parseJoinLink(link(`${good}&x=9`))?.session).toBe('1a2b3c4d');
    expect(parseJoinLink(link(`${good}#top`))?.session).toBe('1a2b3c4d');
  });

  it('accepts a 30-character name', () => {
    expect(parseJoinLink(link(`${good}&n=${'a'.repeat(30)}`))?.name).toBe('a'.repeat(30));
  });

  it.each([
    ['another scheme', `https://join?${good}`],
    ['another host', `zoggyfin://open?${good}`],
    ['no query', 'zoggyfin://join'],
    ['version 2', link(good.replace('v=1', 'v=2'))],
    ['no version', link(good.replace('v=1&', ''))],
    ['IP 256.1.1.1', link(good.replace('172.20.1.4', '256.1.1.1'))],
    ['IP 01.2.3.4', link(good.replace('172.20.1.4', '01.2.3.4'))],
    ['empty address', link(good.replace('172.20.1.4', '172.20.1.4,'))],
    ['5 addresses', link(good.replace('172.20.1.4', '1.1.1.1,1.1.1.2,1.1.1.3,1.1.1.4,1.1.1.5'))],
    ['no address', link(good.replace('a=172.20.1.4&', ''))],
    ['port 0', link(good.replace('p=50123', 'p=0'))],
    ['port 70000', link(good.replace('p=50123', 'p=70000'))],
    ['port 080', link(good.replace('p=50123', 'p=080'))],
    ['port not a number', link(good.replace('p=50123', 'p=abc'))],
    ['short session', link(good.replace('s=1a2b3c4d', 's=1a2b3c'))],
    ['long session', link(good.replace('s=1a2b3c4d', 's=1a2b3c4d5'))],
    ['uppercase session', link(good.replace('s=1a2b3c4d', 's=1A2B3C4D'))],
    ['short key', link(good.replace(KEY, KEY.slice(0, 19)))],
    ['long key', link(good.replace(KEY, `${KEY}0`))],
    ['non-hex key', link(good.replace(KEY, `${KEY.slice(0, 19)}g`))],
    ['a 31-character name', link(`${good}&n=${'a'.repeat(31)}`)],
    ['a repeated field', link(`${good}&p=1`)],
    ['bad URL encoding', link(`${good}&n=%E0%A4%A`)],
    ['a field with no value sign', link(`${good}&n`)],
    ['input over 512 characters', link(`${good}&x=${'a'.repeat(512)}`)],
  ])('rejects %s', (_, url) => {
    expect(parseJoinLink(url)).toBeNull();
  });

  it('never throws on other input', () => {
    expect(parseJoinLink('')).toBeNull();
    expect(parseJoinLink(undefined as unknown as string)).toBeNull();
  });
});

describe('shortCode and parseShortCode', () => {
  it('has the form XXXX-XXXX-XXXX-XXXX-C', () => {
    expect(shortCode(base)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-HJKMNP-TV-Z]$/);
  });

  it('round trips the first address, the port and the key prefix', () => {
    expect(parseShortCode(shortCode(base))).toEqual({ addr: '172.20.1.4', port: 50123, keyPrefix: '01234567' });
    const edge: JoinPayload = { ...base, addrs: ['255.0.255.0'], port: 1, key: 'ffffffff000000000000' };
    expect(parseShortCode(shortCode(edge))).toEqual({ addr: '255.0.255.0', port: 1, keyPrefix: 'ffffffff' });
  });

  it('ignores case, spaces and dashes', () => {
    const code = shortCode(base);
    const messy = ` ${code.toLowerCase().replace(/-/g, ' - ')} `;
    expect(parseShortCode(messy)).toEqual(parseShortCode(code));
    expect(parseShortCode(code.replace(/-/g, ''))).toEqual(parseShortCode(code));
  });

  it('reads I and L as 1, and O as 0', () => {
    // A key prefix of 00000000 gives 0 characters; this address and port give 1 characters.
    const p: JoinPayload = { ...base, addrs: ['8.66.16.132'], port: 4161, key: '00000000000000000000' };
    const code = shortCode(p);
    expect(code).toMatch(/[01]/);
    const typed = code.replace(/1/g, (_, i: number) => (i % 2 ? 'I' : 'l')).replace(/0/g, 'O');
    expect(parseShortCode(typed)).toEqual(parseShortCode(code));
  });

  it('fails the check when one character changes', () => {
    const code = shortCode(base).replace(/-/g, '');
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < code.length; i++) {
      for (const ch of alphabet) {
        if (ch === code[i]) continue;
        const bad = code.slice(0, i) + ch + code.slice(i + 1);
        expect(parseShortCode(bad)).toBeNull();
      }
    }
  });

  it.each([
    ['too short', 'ABCD-EFGH-JKMN-PQRS'],
    ['too long', 'ABCD-EFGH-JKMN-PQRS-TV'],
    ['a U', 'ABCD-EFGH-JKMN-PQRS-U'],
    ['a symbol', 'ABCD-EFGH-JKMN-PQR*-T'],
    ['empty', ''],
  ])('rejects %s', (_, text) => {
    expect(parseShortCode(text)).toBeNull();
  });

  it('rejects port 0 when the check is right', () => {
    // All zero values: address 0.0.0.0, port 0; the check of all zeros is 0.
    expect(parseShortCode('0000-0000-0000-0000-0')).toBeNull();
  });
});

describe('keyMatches', () => {
  it('accepts the full key and its 8-character prefix', () => {
    expect(keyMatches(KEY, KEY)).toBe(true);
    expect(keyMatches(KEY.slice(0, 8), KEY)).toBe(true);
  });

  it('rejects a wrong key or prefix', () => {
    expect(keyMatches(`${KEY.slice(0, 19)}4`, KEY)).toBe(false);
    expect(keyMatches('01234568', KEY)).toBe(false);
  });

  it('rejects other lengths and empty values', () => {
    expect(keyMatches('', KEY)).toBe(false);
    expect(keyMatches(KEY.slice(0, 7), KEY)).toBe(false);
    expect(keyMatches(KEY.slice(0, 9), KEY)).toBe(false);
    expect(keyMatches(KEY.slice(0, 19), KEY)).toBe(false);
    expect(keyMatches('', '')).toBe(false);
    expect(keyMatches('01234567', '01234567')).toBe(false);
  });
});

describe('pickCodeAddress', () => {
  const a = (address: string, kind: LinkAddress['kind'], name = 'x'): LinkAddress => ({ name, address, kind });

  it('orders hotspot, wifi, ethernet, other and keeps the input order inside a kind', () => {
    const out = pickCodeAddress([
      a('10.0.0.9', 'other'),
      a('172.20.1.2', 'ethernet'),
      a('172.20.1.4', 'wifi'),
      a('172.20.49.1', 'hotspot'),
      a('172.20.1.5', 'wifi'),
    ]);
    expect(out.map((x) => x.address)).toEqual(['172.20.49.1', '172.20.1.4', '172.20.1.5', '172.20.1.2']);
  });

  it('removes the same address, bad addresses and loopback', () => {
    const out = pickCodeAddress([
      a('172.20.1.4', 'wifi', 'en0'),
      a('172.20.1.4', 'other', 'bridge100'),
      a('127.0.0.1', 'other'),
      a('fe80::1', 'wifi'),
    ]);
    expect(out).toEqual([a('172.20.1.4', 'wifi', 'en0')]);
  });

  it('returns an empty list for no input', () => {
    expect(pickCodeAddress([])).toEqual([]);
  });
});

describe('wifiQr', () => {
  it('makes a WPA network', () => {
    expect(wifiQr('Hotel', 'secret12')).toBe('WIFI:T:WPA;S:Hotel;P:secret12;;');
  });

  it('escapes backslash, semicolon, comma, colon and quote', () => {
    expect(wifiQr('a;b,c', 'p:q"r\\s')).toBe('WIFI:T:WPA;S:a\\;b\\,c;P:p\\:q\\"r\\\\s;;');
  });

  it('makes an open network for an empty password', () => {
    expect(wifiQr('Open:Net', '')).toBe('WIFI:T:nopass;S:Open\\:Net;;');
  });
});
