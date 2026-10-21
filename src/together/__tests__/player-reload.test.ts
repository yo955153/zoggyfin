/**
 * A together session loads its item while this device's player still shows
 * the old one (it played the same film alone, or another one). Found on the
 * Mac app: the guest bound its port to the old player, which was "ready" and
 * playing. The new load then came up paused, so the port took it for a pause
 * from outside the app and paused the whole group (or, when the load was
 * still busy, the port kept "playing" as its intent and the follower never
 * started the paused player: the video stood still while the group played).
 */
import { bindVideoPort, whenPlayerReady } from '../player-binding';
import { initialPlayerState, type NowPlaying, playerState, setPlayerState } from '@/player/store';

const mockDirect = { play: jest.fn(), pause: jest.fn(), seek: jest.fn(), rate: jest.fn(), position: () => playerState().position };
jest.mock('@/player/session', () => ({ videoSession: () => ({ direct: mockDirect }) }));

const film = (id: string) => ({ kind: 'video', item: { Id: id } }) as unknown as NowPlaying;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  setPlayerState({ ...initialPlayerState, now: film('a'), status: 'ready', playing: true });
});
afterEach(() => jest.useRealTimers());

/** What `videoSession().play()` does: the old item is stopped first (a network report), then the new load starts paused. */
function reload(stopMs: number): void {
  setTimeout(() => {
    setPlayerState({ ...initialPlayerState, status: 'loading' });
    setPlayerState({ now: film('a'), status: 'loading' });
  }, stopMs);
  setTimeout(() => setPlayerState({ status: 'ready', playing: false }), stopMs + 400);
}

describe('whenPlayerReady with a new load', () => {
  it('waits for the new load, not the old item that is still ready', async () => {
    const before = playerState().now;
    reload(300);
    let done: boolean | null = null;
    void whenPlayerReady(30_000, { after: before }).then((ok) => (done = ok));
    await jest.advanceTimersByTimeAsync(100);
    expect(done).toBeNull();
    await jest.advanceTimersByTimeAsync(700);
    expect(done).toBe(true);
    expect(playerState().playing).toBe(false);
  });

  it('a failed load answers false', async () => {
    const before = playerState().now;
    setTimeout(() => setPlayerState({ ...initialPlayerState, status: 'loading' }), 100);
    setTimeout(() => setPlayerState({ status: 'error' }), 200);
    let done: boolean | null = null;
    void whenPlayerReady(30_000, { after: before }).then((ok) => (done = ok));
    await jest.advanceTimersByTimeAsync(300);
    expect(done).toBe(false);
  });
});

describe('the video port after a reload', () => {
  it('takes the play state of the new load, and sends no pause to the group', async () => {
    const outside = jest.fn();
    // Bound while the old item played (the old race): its intent is "playing".
    const port = bindVideoPort(outside);
    expect(port.isPlaying()).toBe(true);
    reload(0);
    await jest.advanceTimersByTimeAsync(2000);
    expect(outside).not.toHaveBeenCalled();
    // The follower sees a paused player and starts it at the group position.
    expect(port.isPlaying()).toBe(false);
    port.dispose();
  });

  it('still reports a pause from the lock screen', async () => {
    const outside = jest.fn();
    const port = bindVideoPort(outside);
    setPlayerState({ playing: false });
    await jest.advanceTimersByTimeAsync(1000);
    expect(outside).toHaveBeenCalledWith({ action: 'pause' });
    port.dispose();
  });
});
