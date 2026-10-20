import { guestHelp, type GuestHelpInput, helpCopy, type HelpItem, visibleTo, type VisibleToInput } from '../nearby-help';

const wifi = (ssid: string | null = 'Home') => ({ type: 'wifi' as const, ssid });
const none = { type: 'none' as const, ssid: null };

describe('visibleTo', () => {
  const v = (over: Partial<VisibleToInput>) =>
    visibleTo({ platform: 'ios', network: null, ble: null, hotspot: null, ...over });

  it('Apple on a named Wi-Fi with Bluetooth on', () => {
    expect(v({ network: wifi('Home'), ble: 'on' })).toEqual([
      'Apple devices nearby (direct)',
      'Devices on the Wi-Fi “Home”',
      'Android devices nearby over Bluetooth',
    ]);
  });

  it('Wi-Fi with no known name', () => {
    expect(v({ platform: 'android', network: wifi(null) })).toEqual(['Devices on this Wi-Fi']);
  });

  it('Mac on ethernet', () => {
    expect(v({ platform: 'mac', network: { type: 'ethernet', ssid: null } })).toEqual([
      'Apple devices nearby (direct)',
      'Devices on this network',
    ]);
  });

  it('Android with a running hotspot and Bluetooth on', () => {
    expect(v({ platform: 'android', network: none, ble: 'on', hotspot: { ssid: 'DIRECT-ab' } })).toEqual([
      'Devices that join the Wi-Fi “DIRECT-ab”',
      'Phones and tablets nearby over Bluetooth',
    ]);
  });

  it('Apple with no Wi-Fi and no Bluetooth', () => {
    expect(v({ network: { type: 'cellular', ssid: null }, ble: 'off' })).toEqual([
      'Apple devices nearby (direct)',
      'No Wi-Fi: Android devices cannot find this session',
    ]);
  });

  it('Android with no Wi-Fi and no Bluetooth', () => {
    expect(v({ platform: 'android', network: null, ble: 'unauthorized' })).toEqual([
      'No Wi-Fi: nobody can find this session. Make a hotspot.',
    ]);
  });

  it('Bluetooth on removes the no Wi-Fi warning', () => {
    expect(v({ platform: 'android', network: none, ble: 'on' })).toEqual(['Phones and tablets nearby over Bluetooth']);
  });

  it('a hotspot removes the no Wi-Fi warning', () => {
    expect(v({ network: none, hotspot: { ssid: 'Net' } })).toEqual([
      'Apple devices nearby (direct)',
      'Devices that join the Wi-Fi “Net”',
    ]);
  });
});

describe('guestHelp', () => {
  const g = (over: Partial<GuestHelpInput>) =>
    guestHelp({
      platform: 'ios',
      elapsedMs: 10_000,
      found: 0,
      network: wifi(),
      localNetwork: 'ok',
      ble: 'on',
      canMakeHotspot: false,
      hasMobileData: false,
      ...over,
    });
  const ids = (r: { items: HelpItem[] }) => r.items.map((i) => i.id);

  it('hides before 8 seconds', () => {
    expect(g({ elapsedMs: 7999 })).toEqual({ show: false, items: [] });
  });

  it('hides when a session is found', () => {
    expect(g({ found: 1 }).show).toBe(false);
  });

  it('shows at 8 seconds with nothing found', () => {
    expect(g({ elapsedMs: 8000 }).show).toBe(true);
  });

  it('shows at once when local network access is denied, permission first', () => {
    const r = g({ elapsedMs: 0, found: 2, localNetwork: 'denied' });
    expect(r.show).toBe(true);
    expect(r.items[0]).toEqual({ id: 'local-network-denied', action: 'open-settings' });
  });

  it('iOS on Wi-Fi', () => {
    expect(ids(g({}))).toEqual(['same-wifi', 'apple-direct', 'isolated-wifi', 'scan-code', 'type-code']);
  });

  it('Bluetooth off and Bluetooth denied', () => {
    expect(g({ ble: 'off' }).items[0]).toEqual({ id: 'bluetooth-off', action: 'open-settings' });
    expect(g({ ble: 'unauthorized' }).items[0]).toEqual({ id: 'bluetooth-denied', action: 'ask-permission' });
    expect(ids(g({ ble: 'unsupported' }))[0]).toBe('same-wifi');
    expect(ids(g({ ble: null }))[0]).toBe('same-wifi');
  });

  it('all permission problems come before the network items', () => {
    expect(ids(g({ localNetwork: 'denied', ble: 'off' })).slice(0, 3)).toEqual([
      'local-network-denied',
      'bluetooth-off',
      'same-wifi',
    ]);
  });

  it('iOS with no Wi-Fi: the Android device makes the hotspot (text only)', () => {
    const r = g({ network: none });
    expect(ids(r)).toEqual(['same-wifi', 'apple-direct', 'android-hotspot', 'scan-code', 'type-code']);
    expect(r.items[2]).toEqual({ id: 'android-hotspot', action: null });
  });

  it('iOS with mobile data adds Personal Hotspot', () => {
    expect(ids(g({ network: none, hasMobileData: true }))).toContain('personal-hotspot');
    expect(ids(g({ hasMobileData: true }))).toContain('personal-hotspot');
  });

  it('only iOS gets Personal Hotspot', () => {
    expect(ids(g({ platform: 'mac', network: none, hasMobileData: true }))).not.toContain('personal-hotspot');
    expect(ids(g({ platform: 'android', network: none, hasMobileData: true }))).not.toContain('personal-hotspot');
  });

  it('Mac on ethernet: no hotspot item and no isolated Wi-Fi item', () => {
    expect(ids(g({ platform: 'mac', network: { type: 'ethernet', ssid: null } }))).toEqual([
      'same-wifi',
      'apple-direct',
      'scan-code',
      'type-code',
    ]);
  });

  it('Android with no Wi-Fi that can make a hotspot', () => {
    const r = g({ platform: 'android', network: null, canMakeHotspot: true });
    expect(ids(r)).toEqual(['same-wifi', 'android-hotspot', 'scan-code', 'type-code']);
    expect(r.items[1]).toEqual({ id: 'android-hotspot', action: 'make-hotspot' });
  });

  it('Android with no Wi-Fi that cannot make a hotspot', () => {
    expect(ids(g({ platform: 'android', network: none }))).toEqual(['same-wifi', 'scan-code', 'type-code']);
  });

  it('Android on Wi-Fi', () => {
    expect(ids(g({ platform: 'android', canMakeHotspot: true }))).toEqual([
      'same-wifi',
      'isolated-wifi',
      'scan-code',
      'type-code',
    ]);
  });
});

describe('helpCopy', () => {
  const all: HelpItem[] = [
    { id: 'local-network-denied', action: 'open-settings' },
    { id: 'bluetooth-off', action: 'open-settings' },
    { id: 'bluetooth-denied', action: 'ask-permission' },
    { id: 'same-wifi' },
    { id: 'apple-direct' },
    { id: 'android-hotspot', action: 'make-hotspot' },
    { id: 'android-hotspot', action: null },
    { id: 'personal-hotspot' },
    { id: 'isolated-wifi' },
    { id: 'scan-code', action: 'scan-code' },
    { id: 'type-code', action: 'type-code' },
  ];

  it.each(all)('has a title and a detail for $id', (item) => {
    const c = helpCopy(item);
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.detail.length).toBeGreaterThan(0);
  });

  it('gives the action of the item, and none for text-only items', () => {
    for (const item of all) {
      const c = helpCopy(item);
      const want = 'action' in item ? item.action : null;
      expect(c.action?.id ?? null).toBe(want);
      if (c.action) expect(c.action.label.length).toBeGreaterThan(0);
    }
  });

  it('keeps the product facts', () => {
    expect(helpCopy({ id: 'personal-hotspot' }).detail).toContain('If your iPhone has mobile data, Personal Hotspot also works.');
    expect(helpCopy({ id: 'android-hotspot', action: null }).detail).toContain('The Android device makes the Wi-Fi network');
    expect(helpCopy({ id: 'isolated-wifi' }).detail).toContain('hotels and on planes');
  });
});
