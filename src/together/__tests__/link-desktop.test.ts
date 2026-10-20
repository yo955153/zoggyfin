const mockInvoke = jest.fn((cmd: string, args?: { cmd?: string }) => Promise.resolve(cmd === 'nearby_call' && args?.cmd === 'monotonicNow' ? 0 : null));
let mockDeliver: (e: { event: string; body: Record<string, unknown> }) => void = () => undefined;

jest.mock('@/platform/desktop', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args as { cmd?: string }),
  isDesktop: true,
  onNearbyEvent: (l: typeof mockDeliver) => {
    mockDeliver = l;
    return () => undefined;
  },
}));

Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'Mac' }, configurable: true });

// After the navigator above: the module looks at it when it loads. Its 60 s clock timer would keep Jest open.
const interval = jest.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { desktopLink, desktopLinkReady } = require('../link-desktop') as typeof import('../link-desktop');
interval.mockRestore();
const invoke = mockInvoke;
const deliver = (e: { event: string; body: Record<string, unknown> }) => mockDeliver(e);

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe('desktop link', () => {
  beforeEach(async () => {
    await desktopLinkReady;
    invoke.mockClear();
  });

  it('sends the short commands of one tick as one batch, in order', async () => {
    const link = desktopLink!;
    deliver({ event: 'onSocketOpen', body: { socketId: 'a', inbound: true } });
    deliver({ event: 'onSocketOpen', body: { socketId: 'b', inbound: true } });
    expect(link.send('a', 'one')).toBe(true);
    link.sendMany!(['a', 'b', 'gone'], 'two');
    link.sendPong!('b', 1, 2, 3);
    link.close('a');
    await flushPromises();
    const posts = invoke.mock.calls.filter((c) => c[0] === 'nearby_post');
    expect(posts).toHaveLength(1);
    expect((posts[0][1] as unknown as { calls: unknown[] }).calls).toEqual([
      { cmd: 'send', args: ['a', 'one'] },
      { cmd: 'sendMany', args: [['a', 'b'], 'two'] },
      { cmd: 'sendPong', args: ['b', 1, 2, 3] },
      { cmd: 'close', args: ['a'] },
    ]);
  });

  it('does not send to a socket that is not open', async () => {
    expect(desktopLink!.send('nope', 'x')).toBe(false);
    await flushPromises();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('runs a long command after the batch before it', async () => {
    const link = desktopLink!;
    deliver({ event: 'onSocketOpen', body: { socketId: 'c', inbound: true } });
    link.send('c', 'first');
    void link.addresses();
    await flushPromises();
    expect(invoke.mock.calls.map((c) => (c[0] === 'nearby_call' ? (c[1] as { cmd: string }).cmd : c[0]))).toEqual(['nearby_post', 'addresses']);
  });
});
