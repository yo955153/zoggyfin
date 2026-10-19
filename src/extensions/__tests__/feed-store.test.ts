import { parseFeed } from '../feed';
import { effectiveValues, sourceValue } from '../store';
import { manifest } from '../test-utils/fixtures';

jest.mock('@/storage/json', () => ({ readJson: (_k: string, fb: unknown) => fb, writeJson: jest.fn() }));
jest.mock('@/storage/secure', () => ({ secureStore: { get: () => null, set: jest.fn(), remove: jest.fn() } }));

describe('parseFeed', () => {
  const base = 'http://192.0.2.10:3000';
  it('reads items and cards, and drops bad entries', () => {
    const out = parseFeed({ items: [{ itemId: 'j1' }, { title: 'Card', image: '/t.jpg', progress: 0.5 }, { subtitle: 'no title' }, 7] }, base);
    expect(out.map((e) => e.key)).toEqual(['j1', '1']);
    expect(out[1].imageUrl).toBe('http://192.0.2.10:3000/t.jpg');
  });
  it('drops images on other origins and non-http links', () => {
    const [e] = parseFeed({ items: [{ title: 'A', image: 'http://evil.example/t.jpg', link: 'javascript:alert(1)' }] }, base);
    expect(e.imageUrl).toBeUndefined();
    expect(e.link).toBeUndefined();
  });
  it('throws for another shape', () => {
    expect(() => parseFeed({ downloads: [] }, base)).toThrow();
  });
});

describe('effectiveValues', () => {
  const account = { serverUrl: 'http://jf', serverId: 's', userId: 'u', userName: 'Sam', isAdmin: true };
  it('fills from the account, the auto values, the defaults and the options', () => {
    const m = manifest();
    const v = effectiveValues(m, { values: {}, auto: { [m.id]: { folder: 'videos' } }, options: {} }, account, () => null);
    expect(v).toEqual({ apiKey: '', user: 'Sam', folder: 'videos', loud: true });
  });
  it('prefers what the user set, and reads secrets from the secure store', () => {
    const m = manifest();
    const v = effectiveValues(m, { values: { [m.id]: { user: 'Jane Doe', loud: false, apiKey: '•' } }, auto: {}, options: { [m.id]: { folder: [{ value: 'music', label: 'Music' }] } } }, account, (k) => (k === 'apiKey' ? 'secret' : null));
    expect(v).toEqual({ apiKey: 'secret', user: 'Jane Doe', folder: 'music', loud: false });
  });
  it('maps every source', () => {
    expect(sourceValue('jellyfin.isAdmin', account)).toBe(true);
    expect(sourceValue('jellyfin.serverId', account)).toBe('s');
    expect(sourceValue('jellyfin.userId', null)).toBeUndefined();
  });
});
