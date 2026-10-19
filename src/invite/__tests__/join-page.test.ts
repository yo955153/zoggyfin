/** The logic of the site's /join page (site/public/join/join-core.js). */
import { encodeInvite, type Invite } from '../payload';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const J = require('../../../site/public/join/join-core.js') as {
  readInvite(p: string): { server: string; user: string; inviter: string; tunnel: 'tailscale' | 'vpn' | null } | null;
  detectPlatform(ua: string, touch?: number): string;
  primaryAction(platform: string, config: Record<string, string>): { label: string; url: string; note: string } | null;
  openUrl(platform: string, payload: string, fallback: string): string;
  bannerContent(id: string, url: string): string;
  tunnelText(i: unknown): string;
};

const invite: Invite = {
  serverId: 'ef7d53c1de134487b2ca335f2b390702',
  serverName: 'Família Media',
  addresses: [{ url: 'https://media.example.com', label: 'internet' }],
  userName: 'Jane Doe',
  password: 'Abcdefghjkmnpqrstuvwxyz2',
  inviter: 'Sam',
};

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

const config = { appStoreUrl: '', testFlightUrl: 'https://testflight.apple.com/join/x', androidUrl: '', macUrl: 'https://releases.example.com/z.dmg', webAppUrl: '' };

describe('join page: readInvite', () => {
  it('reads what the app writes, with no password', () => {
    const r = J.readInvite(encodeInvite(invite));
    expect(r).toEqual({ server: 'Família Media', user: 'Jane Doe', inviter: 'Sam', tunnel: null });
    expect(JSON.stringify(r)).not.toContain(invite.password);
  });
  it('knows Tailscale-only and VPN-only invites', () => {
    expect(J.readInvite(encodeInvite({ ...invite, addresses: [{ url: 'http://100.64.0.1', label: 'tailscale' }] }))?.tunnel).toBe('tailscale');
    expect(J.readInvite(encodeInvite({ ...invite, addresses: [{ url: 'http://100.64.0.1', label: 'tailscale' }, { url: 'http://10.8.0.1', label: 'vpn' }] }))?.tunnel).toBe('vpn');
    expect(J.tunnelText({ server: 'S', tunnel: 'tailscale' })).toBe("Connect to S's Tailscale first, then tap Join in Zoggyfin.");
  });
  it('refuses broken payloads', () => {
    for (const p of ['', 'abc', '%%%', 'A'.repeat(5000), encodeInvite(invite).slice(0, 20)]) expect(J.readInvite(p)).toBeNull();
  });
});

describe('join page: detectPlatform', () => {
  it('finds iPhone, iPad with a desktop user agent, Android, Mac and others', () => {
    expect(J.detectPlatform(UA.iphone, 5)).toBe('ios');
    expect(J.detectPlatform(UA.ipadDesktop, 5)).toBe('ios');
    expect(J.detectPlatform(UA.ipadDesktop, 0)).toBe('mac');
    expect(J.detectPlatform(UA.android, 5)).toBe('android');
    expect(J.detectPlatform(UA.windows, 0)).toBe('other');
    expect(J.detectPlatform('', 0)).toBe('other');
  });
});

describe('join page: primaryAction', () => {
  it('uses the App Store when it exists, else TestFlight with a note', () => {
    expect(J.primaryAction('ios', config)).toMatchObject({ url: config.testFlightUrl, note: expect.stringContaining('TestFlight') });
    expect(J.primaryAction('ios', { ...config, appStoreUrl: 'https://apps.apple.com/app/id1' })).toMatchObject({ url: 'https://apps.apple.com/app/id1', note: '' });
  });
  it('has no Android button until an APK or store link exists', () => {
    expect(J.primaryAction('android', config)).toBeNull();
    expect(J.primaryAction('android', { ...config, androidUrl: 'https://example.com/z.apk' })?.url).toBe('https://example.com/z.apk');
  });
  it('gives the Mac disk image, and the web app only when configured', () => {
    expect(J.primaryAction('mac', config)?.url).toBe(config.macUrl);
    expect(J.primaryAction('other', config)).toBeNull();
    expect(J.primaryAction('other', { ...config, webAppUrl: 'https://web.example.com' })?.url).toBe('https://web.example.com');
  });
});

describe('join page: links', () => {
  it('opens the app with the scheme, or an Android intent link with the invite in the path', () => {
    expect(J.openUrl('ios', 'P1', '')).toBe('zoggyfin://join#P1');
    expect(J.openUrl('android', 'P1', '')).toBe('intent://join/P1#Intent;scheme=zoggyfin;package=com.zogtech.zoggyfin;end');
    expect(J.openUrl('android', 'P1', 'https://example.com/a b')).toBe(
      'intent://join/P1#Intent;scheme=zoggyfin;package=com.zogtech.zoggyfin;S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fa%20b;end',
    );
  });
  it('writes the Smart App Banner content', () => {
    expect(J.bannerContent('6824646949', 'https://zoggyfin.zog-tech.com/join#P')).toBe('app-id=6824646949, app-argument=https://zoggyfin.zog-tech.com/join#P');
  });
});
