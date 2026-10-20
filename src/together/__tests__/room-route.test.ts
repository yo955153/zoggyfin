/**
 * The Play buttons in a room: the host plays here (the room shares it), a
 * guest asks the host, and with no room nothing changes. Also the
 * player controller with the play router set and not set.
 */
import type { BaseItemDto } from '@/api/types';
// jest.mock calls below are hoisted above these imports.
import { playRouter, usePlayer } from '@/player';

import { guestKeyOf, mediaKey, ONLY_HOST_PICKS_TEXT, pickOf, requestOfPick, routeInRoom } from '../room-route';

const mockCalls: string[] = [];
jest.mock('expo-router', () => ({ router: { navigate: (to: string) => mockCalls.push(`navigate ${to}`) } }));
jest.mock('@/lib/toast', () => ({ toast: (text: string) => mockCalls.push(`toast ${text}`) }));
jest.mock('@/player/session', () => ({
  videoSession: () => ({ play: async (r: { item: BaseItemDto; autoplay?: boolean }) => void mockCalls.push(`video ${r.item.Id} autoplay=${String(r.autoplay)}`), stop: async () => undefined }),
}));
jest.mock('@/player/audio/session', () => ({
  audioSession: () => ({
    play: async (r: { item: BaseItemDto }) => void mockCalls.push(`audio ${r.item.Id}`),
    stopForVideo: async () => undefined,
    instantMix: async () => void mockCalls.push('mix'),
    playNext: async () => undefined,
    addToQueue: async () => undefined,
  }),
}));

const film: BaseItemDto = { Id: 'f1', Name: 'Dune', Type: 'Movie', ServerId: 'srv' };
const album: BaseItemDto = { Id: 'a1', Name: 'Album', Type: 'MusicAlbum', ServerId: 'srv' };
const song = (i: number): BaseItemDto => ({ Id: `t${i}`, Name: `Song ${i}`, Type: 'Audio', MediaType: 'Audio', ServerId: 'srv' });

describe('routeInRoom', () => {
  it('with no room, a Play button plays here, unchanged', () => {
    const r = { item: film };
    expect(routeInRoom({ role: 'none' }, r, false)).toEqual({ kind: 'here', request: r });
  });

  it('the host plays here: a video loads paused (the group starts it), audio as it is', () => {
    expect(routeInRoom({ role: 'host' }, { item: film }, false)).toEqual({ kind: 'here', request: { item: film, autoplay: false } });
    expect(routeInRoom({ role: 'host' }, { item: album }, true)).toEqual({ kind: 'here', request: { item: album } });
  });

  it('a guest asks the host when it may pick', () => {
    const r = routeInRoom({ role: 'guest', onlyHostControls: false }, { item: film, startPositionTicks: 0 }, false);
    expect(r).toEqual({ kind: 'pick', pick: { item: { id: 'f1', name: 'Dune', type: 'Movie', serverId: 'srv', mediaType: null }, start: 0 } });
  });

  it('a guest gets a clear no when only the host picks', () => {
    expect(routeInRoom({ role: 'guest', onlyHostControls: true }, { item: film }, false)).toEqual({ kind: 'denied', reason: ONLY_HOST_PICKS_TEXT });
  });
});

describe('pickOf / requestOfPick', () => {
  it('a track in an album goes to the host as the list, the index and the album', () => {
    const list = [song(1), song(2), song(3)];
    const back = requestOfPick(pickOf({ item: list[1]!, list, index: 1, context: album }));
    expect(back.item.Id).toBe('t2');
    expect(back.list?.map((i) => i.Id)).toEqual(['t1', 't2', 't3']);
    expect(back.index).toBe(1);
    expect(back.context?.Id).toBe('a1');
    // The audio player needs the media type of each track.
    expect(back.list?.[0]?.MediaType).toBe('Audio');
  });

  it('cuts a long list around the item', () => {
    const list = Array.from({ length: 1000 }, (_, i) => song(i));
    const p = pickOf({ item: list[700]!, list, index: 700 });
    expect(p.list).toHaveLength(300);
    expect(p.list?.[p.index!]?.id).toBe('t700');
  });
});

describe('media keys', () => {
  it('names a video by its id and all audio as one queue', () => {
    expect(mediaKey(null)).toBeNull();
    expect(mediaKey({ kind: 'video', item: { Id: 'f1' } })).toBe('video:f1');
    expect(mediaKey({ kind: 'audio', item: { Id: 't1' } })).toBe('audio');
    expect(guestKeyOf('video', { id: 'f1' })).toBe(mediaKey({ kind: 'video', item: { Id: 'f1' } }));
    expect(guestKeyOf('audio', null)).toBe('none');
  });
});

describe('usePlayer().play with the play router', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    mockCalls.length = 0;
    playRouter.set(null);
  });

  it('with no session, plays here and opens the player', async () => {
    usePlayer().play({ item: film });
    await flush();
    expect(mockCalls).toEqual(['video f1 autoplay=undefined', 'navigate /player']);
  });

  it('the host of a room: the room routes the request, the video loads paused', async () => {
    playRouter.set({ route: (r) => routeInRoom({ role: 'host' }, r, false).kind === 'here' ? { ...r, autoplay: false } : null, autoplay: () => true, queueLock: () => null });
    usePlayer().play({ item: film });
    await flush();
    expect(mockCalls).toEqual(['video f1 autoplay=false', 'navigate /player']);
  });

  it('a guest of a room: nothing plays here, the request goes to the session', async () => {
    const taken: string[] = [];
    playRouter.set({
      route: (r) => {
        taken.push(r.item.Id!);
        return null;
      },
      autoplay: () => false,
      queueLock: () => 'The host picks what plays in this session.',
    });
    usePlayer().play({ item: film });
    usePlayer().instantMix(album);
    await flush();
    expect(taken).toEqual(['f1']);
    expect(mockCalls).toEqual(['toast The host picks what plays in this session.']);
    expect(playRouter.autoplay()).toBe(false);
  });

  it('with no session, autoplay is on', () => {
    expect(playRouter.autoplay()).toBe(true);
  });
});
