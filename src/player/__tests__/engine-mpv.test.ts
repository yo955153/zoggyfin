import type { MpvTrack } from '@/platform/desktop';

import { nowPlayingInfo, trackFor } from '../engine-mpv';

function track(id: number, type: MpvTrack['type'], ffIndex: number | null, external = false): MpvTrack {
  return { id, type, ffIndex, external, title: null, lang: null, codec: null, selected: false };
}

describe('libmpv track for a Jellyfin stream', () => {
  // An MKV: video 0, audio 1 and 2, subtitles 3 (ASS) and 4 (PGS), plus a subtitle file added later.
  const tracks = [
    track(1, 'video', 0),
    track(1, 'audio', 1),
    track(2, 'audio', 2),
    track(1, 'sub', 3),
    track(2, 'sub', 4),
    track(3, 'sub', null, true),
  ];

  it('matches the stream index in the file', () => {
    expect(trackFor(tracks, 'audio', 2, -1)?.id).toBe(2);
    expect(trackFor(tracks, 'sub', 4, -1)?.id).toBe(2);
  });

  it('falls back to the position among the embedded tracks', () => {
    const noIndex = tracks.map((t) => ({ ...t, ffIndex: null }));
    expect(trackFor(noIndex, 'audio', 2, 1)?.id).toBe(2);
    expect(trackFor(noIndex, 'sub', 3, 0)?.id).toBe(1);
  });

  it('never picks an added subtitle file for an embedded stream', () => {
    expect(trackFor(tracks, 'sub', 9, 2)).toBeNull();
  });
});

describe('Now Playing for libmpv video', () => {
  const state = { duration: 5400, position: 61.5, paused: false, rate: 1 };

  it('shows nothing when no file plays', () => {
    expect(nowPlayingInfo(null, state)).toBeNull();
  });

  it('shows the title, the times and the play state', () => {
    expect(nowPlayingInfo({ title: 'Movie', subtitle: '2024', artworkUri: 'https://s/Items/1/Images/Primary' }, { ...state, paused: true })).toEqual({
      title: 'Movie',
      subtitle: '2024',
      artworkUrl: 'https://s/Items/1/Images/Primary',
      duration: 5400,
      position: 61.5,
      playing: false,
      rate: 1,
    });
  });

  it('leaves out artwork that is not on a server', () => {
    expect(nowPlayingInfo({ title: 'Movie', artworkUri: 'asset://localhost/x/primary.jpg' }, state)?.artworkUrl).toBeUndefined();
  });
});
