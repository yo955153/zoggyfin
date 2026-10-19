import { positionAt } from '../drift';
import { commandEffect, groupStateLabel, groupView, queueTarget, secondsToTicks, ticksToSeconds } from '../syncplay-logic';

const when = '2026-10-19T12:00:00.000Z';
const whenMs = Date.UTC(2026, 9, 19, 12);

describe('commandEffect', () => {
  it('turns Unpause into a playing anchor on the server clock', () => {
    const e = commandEffect({ Command: 'Unpause', When: when, PositionTicks: 600_000_000 });
    expect(e).toEqual({ kind: 'anchor', anchor: { playing: true, rate: 1, hostTime: whenMs, position: 60 }, reportReady: false });
    if (e.kind === 'anchor') expect(positionAt(e.anchor, whenMs + 2500)).toBe(62.5);
  });

  it('pauses, and asks for a Ready after a seek', () => {
    expect(commandEffect({ Command: 'Pause', When: when, PositionTicks: 10_000_000 })).toMatchObject({ anchor: { playing: false, position: 1 }, reportReady: false });
    expect(commandEffect({ Command: 'Seek', When: when, PositionTicks: 0 })).toMatchObject({ anchor: { playing: false, position: 0 }, reportReady: true });
  });

  it('stops, and ignores unknown or undated commands', () => {
    expect(commandEffect({ Command: 'Stop' })).toEqual({ kind: 'stop' });
    expect(commandEffect({ Command: 'Dance', When: when })).toEqual({ kind: 'ignore' });
    expect(commandEffect({ Command: 'Unpause' })).toEqual({ kind: 'ignore' });
  });
});

describe('queueTarget', () => {
  it('finds the playing item', () => {
    expect(
      queueTarget({
        Playlist: [
          { ItemId: 'a', PlaylistItemId: 'pa' },
          { ItemId: 'b', PlaylistItemId: 'pb' },
        ],
        PlayingItemIndex: 1,
        StartPositionTicks: 50_000_000,
        IsPlaying: true,
      }),
    ).toEqual({ itemId: 'b', playlistItemId: 'pb', startSeconds: 5, isPlaying: true, queue: ['a', 'b'], index: 1 });
  });

  it('returns null for an empty queue', () => {
    expect(queueTarget({ Playlist: [], PlayingItemIndex: 0 })).toBeNull();
    expect(queueTarget({})).toBeNull();
  });
});

describe('groups', () => {
  it('maps the server group and labels the state', () => {
    expect(groupView({ GroupId: 'g', GroupName: '', State: 'Waiting', Participants: ['Sam'] })).toEqual({
      id: 'g',
      name: 'Group',
      state: 'Waiting',
      participants: ['Sam'],
    });
    expect(groupView({})).toBeNull();
    expect(groupStateLabel('Waiting')).toBe('Waiting for everyone');
    expect(groupStateLabel('Idle')).toBe('Nothing playing');
  });

  it('converts ticks', () => {
    expect(ticksToSeconds(25_000_000)).toBe(2.5);
    expect(ticksToSeconds(null)).toBe(0);
    expect(secondsToTicks(2.5)).toBe(25_000_000);
    expect(secondsToTicks(-1)).toBe(0);
  });
});
