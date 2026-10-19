import { addressChoices, addressWarning, chosenAddresses, labelFor } from '../addresses';

describe('labelFor', () => {
  it('labels internet, Tailscale, VPN and home network addresses', () => {
    expect(labelFor({ url: 'https://media.example.com', kind: 'external' })).toBe('internet');
    expect(labelFor({ url: 'http://203.0.113.7:8096', kind: 'external' })).toBe('internet');
    expect(labelFor({ url: 'http://100.101.2.3:8096', kind: 'external' })).toBe('tailscale');
    expect(labelFor({ url: 'http://100.64.0.1', kind: 'internal' })).toBe('tailscale');
    expect(labelFor({ url: 'https://nas.tail1234.ts.net', kind: 'external' })).toBe('tailscale');
    expect(labelFor({ url: 'http://10.0.0.5:8096', kind: 'internal' })).toBe('home');
    expect(labelFor({ url: 'http://jellyfin.local:8096', kind: 'internal' })).toBe('home');
  });

  it('calls a private address VPN when it is saved as external or marked', () => {
    expect(labelFor({ url: 'http://10.8.0.1:8096', kind: 'external' })).toBe('vpn');
    expect(labelFor({ url: 'http://10.8.0.1:8096', kind: 'internal' }, new Set(['http://10.8.0.1:8096']))).toBe('vpn');
  });
});

describe('addressChoices', () => {
  it('keeps the order and leaves out home network addresses by default', () => {
    const list = addressChoices([
      { url: 'http://10.0.0.5:8096', kind: 'internal' },
      { url: 'https://media.example.com', kind: 'external' },
      { url: 'http://100.101.2.3:8096', kind: 'external' },
    ]);
    expect(list).toEqual([
      { url: 'http://10.0.0.5:8096', label: 'home', include: false },
      { url: 'https://media.example.com', label: 'internet', include: true },
      { url: 'http://100.101.2.3:8096', label: 'tailscale', include: true },
    ]);
    expect(chosenAddresses(list, new Set(['http://100.101.2.3:8096', 'http://10.0.0.5:8096']))).toEqual([
      { url: 'http://10.0.0.5:8096', label: 'home' },
      { url: 'http://100.101.2.3:8096', label: 'tailscale' },
    ]);
  });
});

describe('addressWarning', () => {
  it('warns only when no chosen address works away from home', () => {
    expect(addressWarning([])).toBe('none');
    expect(addressWarning([{ url: 'http://10.0.0.5', label: 'home' }])).toBe('home-only');
    expect(addressWarning([{ url: 'http://10.0.0.5', label: 'home' }, { url: 'http://100.64.0.2', label: 'tailscale' }])).toBeNull();
    expect(addressWarning([{ url: 'http://10.8.0.1', label: 'vpn' }])).toBeNull();
  });
});
