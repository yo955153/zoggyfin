import {
  base64UrlDecode,
  base64UrlEncode,
  decodeInvite,
  encodeInvite,
  type Invite,
  inviteLink,
  inviteMessage,
  LIMITS,
  needsTunnel,
  payloadFromText,
  savedAddresses,
} from '../payload';

const invite: Invite = {
  serverId: 'ef7d53c1de134487b2ca335f2b390702',
  serverName: 'Family Media',
  addresses: [
    { url: 'https://media.example.com', label: 'internet' },
    { url: 'http://100.101.2.3:8096', label: 'tailscale' },
  ],
  userName: 'Jane Doe',
  password: 'Abcdefghjkmnpqrstuvwxyz2',
  inviter: 'Sam',
};

function wire(obj: unknown): string {
  return base64UrlEncode(JSON.stringify(obj));
}

describe('base64url', () => {
  it('round-trips UTF-8 text with no padding and no + or /', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'مرحبا', '日本語 🎬', '??>>~~']) {
      const e = base64UrlEncode(s);
      expect(e).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64UrlDecode(e)).toBe(s);
    }
  });
  it('refuses bad text and bad UTF-8', () => {
    expect(base64UrlDecode('ab+c')).toBeNull();
    expect(base64UrlDecode('a')).toBeNull();
    expect(base64UrlDecode('_w')).toBeNull(); // 0xFF
    expect(base64UrlDecode('wA')).toBeNull(); // overlong 0xC0
  });
});

describe('encodeInvite / decodeInvite', () => {
  it('round-trips an invite', () => {
    const r = decodeInvite(encodeInvite(invite));
    expect(r).toEqual({ ok: true, invite });
  });

  it('keeps the extension list and drops duplicates', () => {
    const urls = ['https://ext.example.com/a/manifest.json', 'https://ext.example.com/a/manifest.json', 'https://ext.example.com/b.json'];
    const r = decodeInvite(encodeInvite({ ...invite, extensions: urls }));
    expect(r.ok && r.invite.extensions).toEqual([urls[0], urls[2]]);
  });

  it('refuses a different version', () => {
    const r = decodeInvite(wire({ v: 2, sid: 'ab', sn: 'S', a: [['https://a.example', 'i']], u: 'x', p: 'p'.repeat(20), by: '' }));
    expect(r).toEqual({ ok: false, error: 'version' });
  });

  it('refuses addresses that are not http or https', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://a.example', 'https://user:pw@a.example', '']) {
      const r = decodeInvite(wire({ v: 1, sid: 'ab', sn: 'S', a: [[url, 'i']], u: 'x', p: 'p'.repeat(20), by: '' }));
      expect(r).toEqual({ ok: false, error: 'address' });
    }
  });

  it('refuses an empty, too long or badly labelled address list', () => {
    const base = { v: 1, sid: 'ab', sn: 'S', u: 'x', p: 'p'.repeat(20), by: '' };
    expect(decodeInvite(wire({ ...base, a: [] }))).toEqual({ ok: false, error: 'address' });
    expect(decodeInvite(wire({ ...base, a: Array.from({ length: LIMITS.addresses + 1 }, (_, i) => [`https://a${i}.example`, 'i']) }))).toEqual({ ok: false, error: 'address' });
    expect(decodeInvite(wire({ ...base, a: [['https://a.example', 'z']] }))).toEqual({ ok: false, error: 'address' });
  });

  it('refuses fields that are missing, too long or have control characters', () => {
    const good = { v: 1, sid: 'ab', sn: 'S', a: [['https://a.example', 'i']], u: 'x', p: 'p'.repeat(20), by: '' };
    expect(decodeInvite(wire(good)).ok).toBe(true);
    for (const bad of [
      { sid: 'not hex!' },
      { sid: 'a'.repeat(LIMITS.serverId + 1) },
      { sn: '' },
      { sn: 'x'.repeat(LIMITS.serverName + 1) },
      { u: '' },
      { u: 'a\nb' },
      { p: 'short' },
      { p: 'p'.repeat(LIMITS.passwordMax + 1) },
      { by: 'x'.repeat(LIMITS.inviter + 1) },
      { x: 'https://a.example' },
      { x: ['javascript:1'] },
      { x: Array.from({ length: LIMITS.extensions + 1 }, (_, i) => `https://e${i}.example/m.json`) },
    ]) {
      expect(decodeInvite(wire({ ...good, ...bad })).ok).toBe(false);
    }
  });

  it('refuses text that is not an invite', () => {
    expect(decodeInvite('')).toEqual({ ok: false, error: 'format' });
    expect(decodeInvite('%%%')).toEqual({ ok: false, error: 'format' });
    expect(decodeInvite(base64UrlEncode('not json'))).toEqual({ ok: false, error: 'format' });
    expect(decodeInvite(base64UrlEncode('[1]'))).toEqual({ ok: false, error: 'format' });
    expect(decodeInvite('A'.repeat(LIMITS.encoded + 4))).toEqual({ ok: false, error: 'format' });
  });

  it('normalizes the addresses', () => {
    const r = decodeInvite(wire({ v: 1, sid: 'ab', sn: 'S', a: [['HTTPS://Media.Example.com/web/', 'i']], u: 'x', p: 'p'.repeat(20), by: '' }));
    expect(r.ok && r.invite.addresses).toEqual([{ url: 'https://media.example.com', label: 'internet' }]);
  });
});

describe('links', () => {
  it('puts the payload in the fragment of the site link', () => {
    const link = inviteLink(invite);
    expect(link.startsWith('https://zoggyfin.zog-tech.com/join#')).toBe(true);
    expect(link).not.toContain('?');
    expect(link).not.toContain(invite.password);
  });

  it('finds the payload in a link, a scheme link or a whole message', () => {
    const link = inviteLink(invite);
    const payload = link.split('#')[1];
    expect(payloadFromText(link)).toBe(payload);
    expect(payloadFromText(`zoggyfin://join#${payload}`)).toBe(payload);
    expect(payloadFromText(`zoggyfin://join/${payload}`)).toBe(payload);
    expect(payloadFromText('zoggyfin://join?v=1&c=abc')).toBeNull();
    expect(payloadFromText(inviteMessage(invite, link))).toBe(payload);
    expect(payloadFromText('https://evil.example/join#abc')).toBeNull();
    expect(payloadFromText('hello')).toBeNull();
  });

  it('writes the message', () => {
    expect(inviteMessage(invite, 'L')).toBe('Sam invited you to watch on Family Media. Open this link to join: L');
    expect(inviteMessage({ ...invite, inviter: ' ' }, 'L')).toBe('Someone invited you to watch on Family Media. Open this link to join: L');
  });
});

describe('address list', () => {
  it('saves home addresses as internal and the others as external, in order', () => {
    expect(
      savedAddresses({
        addresses: [
          { url: 'https://a.example', label: 'internet' },
          { url: 'http://100.64.0.1', label: 'tailscale' },
          { url: 'http://10.8.0.1', label: 'vpn' },
          { url: 'http://10.0.0.5', label: 'home' },
        ],
      }),
    ).toEqual([
      { url: 'https://a.example', kind: 'external' },
      { url: 'http://100.64.0.1', kind: 'external' },
      { url: 'http://10.8.0.1', kind: 'external' },
      { url: 'http://10.0.0.5', kind: 'internal' },
    ]);
  });

  it('knows when the person must connect to Tailscale or a VPN first', () => {
    expect(needsTunnel([{ url: 'http://100.64.0.1', label: 'tailscale' }])).toBe('tailscale');
    expect(needsTunnel([{ url: 'http://100.64.0.1', label: 'tailscale' }, { url: 'http://10.8.0.1', label: 'vpn' }])).toBe('vpn');
    expect(needsTunnel([{ url: 'http://100.64.0.1', label: 'tailscale' }, { url: 'https://a.example', label: 'internet' }])).toBeNull();
    expect(needsTunnel([{ url: 'http://10.0.0.5', label: 'home' }])).toBeNull();
    expect(needsTunnel([])).toBeNull();
  });
});
