import { handleBridgeRequest, readBridgeMessage, sameOrigin } from '../bridge';

const deps = () => ({ context: jest.fn(() => ({ a: 1 })), play: jest.fn(), openItem: jest.fn(), refreshLibrary: jest.fn(), toast: jest.fn(), close: jest.fn() });

describe('bridge', () => {
  it('reads a request from an object or JSON text', () => {
    expect(readBridgeMessage({ zoggyfin: 1, id: 1, method: 'toast', params: { text: 'hi' } })).toEqual({ id: 1, method: 'toast', params: { text: 'hi' } });
    expect(readBridgeMessage('{"zoggyfin":1,"id":"a","method":"close"}')).toEqual({ id: 'a', method: 'close', params: {} });
  });
  it('ignores other messages and unknown methods', () => {
    expect(readBridgeMessage({ id: 1, method: 'toast' })).toBeNull();
    expect(readBridgeMessage({ zoggyfin: 1, id: 1, method: 'eval' })).toBeNull();
    expect(readBridgeMessage('not json')).toBeNull();
  });
  it('checks the origin', () => {
    expect(sameOrigin('http://192.0.2.10:3000/panel', 'http://192.0.2.10:3000')).toBe(true);
    expect(sameOrigin('http://evil.example/panel', 'http://192.0.2.10:3000')).toBe(false);
    expect(sameOrigin(null, 'http://192.0.2.10:3000')).toBe(false);
  });
  it('runs each method', async () => {
    const d = deps();
    expect(await handleBridgeRequest({ id: 1, method: 'getContext', params: {} }, d)).toEqual({ zoggyfin: 1, id: 1, result: { a: 1 } });
    await handleBridgeRequest({ id: 2, method: 'play', params: { itemId: 'abc123' } }, d);
    expect(d.play).toHaveBeenCalledWith('abc123');
    await handleBridgeRequest({ id: 3, method: 'toast', params: { text: 'Hi' } }, d);
    expect(d.toast).toHaveBeenCalledWith('Hi');
    await handleBridgeRequest({ id: 4, method: 'refreshLibrary', params: {} }, d);
    await handleBridgeRequest({ id: 5, method: 'close', params: {} }, d);
    expect(d.refreshLibrary).toHaveBeenCalled();
    expect(d.close).toHaveBeenCalled();
  });
  it('answers an error for bad params', async () => {
    const r = await handleBridgeRequest({ id: 6, method: 'openItem', params: { itemId: '../x' } }, deps());
    expect(r.error).toMatch(/itemId/);
  });
});
