/**
 * Audio after video: the video stops and its full-screen player closes
 * once, so no video surface stays under the music player with an old frame.
 */
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockStop = jest.fn(() => Promise.resolve());
const mockAudioPlay = jest.fn(() => Promise.resolve());

jest.mock('expo-router', () => ({ router: { back: () => mockBack(), replace: (p: string) => mockReplace(p), canGoBack: () => true, navigate: jest.fn() } }));
jest.mock('@/auth/session-store', () => ({ useSessionStore: { getState: () => ({ session: { serverId: 's' } }) } }));
jest.mock('@/lib/toast', () => ({ toast: jest.fn() }));
jest.mock('../session', () => ({ videoSession: () => ({ stop: mockStop, play: jest.fn() }) }));
jest.mock('../audio/session', () => ({ audioSession: () => ({ play: mockAudioPlay, stopForVideo: jest.fn() }) }));
jest.mock('../play-router', () => ({ playRouter: { route: (r: unknown) => r, queueLock: () => null } }));

// eslint-disable-next-line import/first
import { playHere, stopVideoForAudio } from '../index';
// eslint-disable-next-line import/first
import { playerState, setPlayerState } from '../store';

const video = { kind: 'video', item: { Id: 'v1', Type: 'Movie' } } as unknown as NonNullable<ReturnType<typeof playerState>['now']>;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  setPlayerState({ now: video, presentation: 'full' });
});

it('closes the full-screen video player once, then stops the video', async () => {
  await Promise.all([stopVideoForAudio(), stopVideoForAudio()]);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(playerState().presentation).toBe('hidden');
  expect(mockStop).toHaveBeenCalled();
});

it('a Play button for music while the video player shows: the player closes before the music starts', async () => {
  playHere({ item: { Id: 'a1', Type: 'MusicAlbum' } });
  await flush();
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(mockAudioPlay).toHaveBeenCalledTimes(1);
});

it('does not leave a screen when the video plays in the mini player', async () => {
  setPlayerState({ presentation: 'mini' });
  await stopVideoForAudio();
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockStop).toHaveBeenCalledTimes(1);
});
