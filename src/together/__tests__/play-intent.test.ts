import { PENDING_LIMIT, PlayIntent } from '../play-intent';
import type { PlayerPort } from '../player-port';
import { HostRoom } from '../room';
import { VirtualClock } from '../test-utils/sim';

describe('PlayIntent: what a guest play button shows', () => {
  it('shows the group state when nothing was sent', () => {
    const i = new PlayIntent(() => 0);
    expect(i.value(null)).toBeNull();
    expect(i.value(true)).toBe(true);
    expect(i.holdsPause).toBe(false);
  });

  it('shows a sent pause until the group agrees, and holds the player meanwhile', () => {
    let t = 0;
    const i = new PlayIntent(() => t);
    i.sent(false);
    // A heartbeat that left the host before the pause: still "playing".
    i.group(true);
    expect(i.value(true)).toBe(false);
    expect(i.holdsPause).toBe(true);
    i.group(false);
    t = 100;
    expect(i.value(true)).toBe(true);
    expect(i.holdsPause).toBe(false);
  });

  it('lets a control go that the group did not take', () => {
    let t = 0;
    const i = new PlayIntent(() => t);
    i.sent(true);
    t = PENDING_LIMIT + 1;
    expect(i.value(false)).toBe(false);
  });
});

describe('HostRoom: a play while the group plays', () => {
  function port() {
    const calls: string[] = [];
    let playing = false;
    const p: PlayerPort = {
      position: () => 10,
      isPlaying: () => playing,
      isBuffering: () => false,
      play: () => ((playing = true), calls.push('play')),
      pause: () => ((playing = false), calls.push('pause')),
      seek: (s) => calls.push(`seek ${s}`),
      setRate: () => undefined,
      onBuffering: () => () => undefined,
    };
    return { p, calls };
  }

  it('only repeats the state: no pause for the start lead', () => {
    const clock = new VirtualClock();
    const { p, calls } = port();
    const sent: string[] = [];
    const room = new HostRoom(
      { send: (m) => sent.push(m.t), now: () => clock.t, player: p, timers: clock },
      { sessionId: 's', item: { id: 'i', name: 'Film', type: 'Movie' }, stream: null, onlyHostControls: false },
    );
    room.apply({ action: 'play' });
    clock.advance(1000);
    expect(calls).toEqual(['pause', 'seek 10', 'play']);
    calls.length = 0;
    room.apply({ action: 'play' });
    clock.advance(1000);
    expect(calls).toEqual([]);
    expect(room.state.anchor.playing).toBe(true);
    // A play during the planned start (a double tap) keeps that start.
    room.apply({ action: 'pause' });
    room.apply({ action: 'play' });
    calls.length = 0;
    clock.advance(100);
    room.apply({ action: 'play' });
    clock.advance(1000);
    expect(calls).toEqual(['play']);
    room.dispose();
  });
});
