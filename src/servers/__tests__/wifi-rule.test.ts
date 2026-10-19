import { type NetworkSnapshot, parseSsidList, wifiPreference } from '../wifi-rule';

/** A fake network source: what the system would report. */
const net = (type: NetworkSnapshot['type'], ssid: string | null = null): NetworkSnapshot => ({ type, ssid });
const rule = { enabled: true, ssids: ['Home', 'Home 5G'] };

describe('wifiPreference', () => {
  it('asks for internal on a named Wi-Fi', () => {
    expect(wifiPreference(rule, net('wifi', 'Home'))).toBe('internal');
    expect(wifiPreference(rule, net('wifi', ' Home 5G '))).toBe('internal');
  });
  it('asks for external on another Wi-Fi and on cellular', () => {
    expect(wifiPreference(rule, net('wifi', 'Cafe'))).toBe('external');
    expect(wifiPreference(rule, net('cellular'))).toBe('external');
  });
  it('compares names exactly', () => {
    expect(wifiPreference(rule, net('wifi', 'home'))).toBe('external');
  });
  it('has no opinion without a Wi-Fi name, on ethernet, when off or with no names', () => {
    expect(wifiPreference(rule, net('wifi', null))).toBeNull();
    expect(wifiPreference(rule, net('ethernet'))).toBeNull();
    expect(wifiPreference(rule, null)).toBeNull();
    expect(wifiPreference({ ...rule, enabled: false }, net('wifi', 'Home'))).toBeNull();
    expect(wifiPreference({ enabled: true, ssids: [' '] }, net('cellular'))).toBeNull();
  });
});

describe('parseSsidList', () => {
  it('splits on commas and new lines, trims and drops repeats', () => {
    expect(parseSsidList('Home, Home 5G,\nHome ,')).toEqual(['Home', 'Home 5G']);
  });
});
