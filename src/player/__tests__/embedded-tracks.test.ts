import { expoTrackId, fromExpoVideo, fromHls, fromMediaElement, fromMpv, hasTrackChoice, sameEmbeddedTracks } from '../embedded-tracks';

describe('fromHls', () => {
  it('lists the renditions by their index, with codecs and flags', () => {
    const t = fromHls(
      [
        { name: 'English', lang: 'en', default: true, audioCodec: 'mp4a.40.2' },
        { name: 'Français', lang: 'fr', audioCodec: 'ac-3' },
      ],
      1,
      [{ name: 'English', lang: 'en', forced: true, textCodec: 'wvtt' }],
      -1,
    );
    expect(t.audio.map((a) => [a.id, a.language, a.codec, a.isDefault])).toEqual([
      ['0', 'en', 'mp4a.40.2', true],
      ['1', 'fr', 'ac-3', false],
    ]);
    expect(t.subtitles[0]).toMatchObject({ id: '0', isForced: true, codec: 'wvtt' });
    expect(t.audioId).toBe('1');
    expect(t.subtitleId).toBeNull();
  });

  it('ignores a selection outside the list', () => {
    expect(fromHls([], -1, [], 4)).toEqual({ audio: [], subtitles: [], audioId: null, subtitleId: null });
  });
});

describe('fromMediaElement', () => {
  it('keeps subtitles and drops metadata tracks, with ids from the list positions', () => {
    const t = fromMediaElement(
      [
        { id: '1', kind: 'main', label: '', language: 'en', enabled: false },
        { id: '1', kind: 'translation', label: 'Deutsch', language: 'de', enabled: true },
      ],
      [
        { id: '', kind: 'metadata', label: 'id3', language: '', mode: 'hidden' },
        { id: '', kind: 'subtitles', label: 'English', language: 'en', mode: 'showing' },
        { id: '', kind: 'forced', label: '', language: 'en', mode: 'disabled' },
      ],
    );
    expect(t.audio.map((a) => a.id)).toEqual(['0', '1']);
    expect(t.audio[0].isDefault).toBe(true);
    expect(t.audioId).toBe('1');
    expect(t.subtitles.map((s) => s.id)).toEqual(['1', '2']);
    expect(t.subtitles[1].isForced).toBe(true);
    expect(t.subtitleId).toBe('1');
  });
});

describe('fromExpoVideo', () => {
  it('uses the Android id when there is one', () => {
    const audio = [
      { id: '1:0', language: 'en', label: 'English', name: 'Main' },
      { id: '1:1', language: 'es', label: 'Spanish' },
    ];
    const t = fromExpoVideo(audio, audio[1], [], null);
    expect(t.audio.map((a) => a.id)).toEqual(['id:1:0', 'id:1:1']);
    expect(t.audio[0].title).toBe('Main');
    expect(t.audioId).toBe('id:1:1');
    expect(t.subtitleId).toBeNull();
  });

  it('makes an id from the label and language on iOS', () => {
    const subs = [
      { language: 'en', label: 'English', isDefault: true },
      { language: 'fr', label: 'French' },
    ];
    const t = fromExpoVideo([], null, subs, { language: 'fr', label: 'French' });
    expect(t.subtitles[0].isDefault).toBe(true);
    expect(t.subtitleId).toBe(expoTrackId(subs[1], 1));
  });
});

describe('fromMpv', () => {
  it('lists the tracks in the file by libmpv id, without video or added files', () => {
    const t = fromMpv([
      { id: 1, type: 'video', external: false, title: null, lang: null, codec: 'h264', selected: true },
      { id: 1, type: 'audio', external: false, title: 'Surround', lang: 'eng', codec: 'eac3', selected: false, isDefault: true },
      { id: 2, type: 'audio', external: false, title: null, lang: 'ger', codec: 'ac3', selected: true },
      { id: 1, type: 'sub', external: false, title: null, lang: 'eng', codec: 'hdmv_pgs_subtitle', selected: false, forced: true },
      { id: 2, type: 'sub', external: true, title: 'added.srt', lang: null, codec: 'subrip', selected: false },
    ]);
    expect(t.audio.map((a) => [a.id, a.codec, a.isDefault])).toEqual([
      ['1', 'eac3', true],
      ['2', 'ac3', false],
    ]);
    expect(t.audioId).toBe('2');
    expect(t.subtitles).toHaveLength(1);
    expect(t.subtitles[0].isForced).toBe(true);
    expect(t.subtitleId).toBeNull();
  });
});

describe('helpers', () => {
  it('sees a repeated list as the same', () => {
    const a = fromHls([{ lang: 'en' }], 0, [], -1);
    expect(sameEmbeddedTracks(a, fromHls([{ lang: 'en' }], 0, [], -1))).toBe(true);
    expect(sameEmbeddedTracks(a, fromHls([{ lang: 'en' }], -1, [], -1))).toBe(false);
    expect(sameEmbeddedTracks(a, fromHls([{ lang: 'de' }], 0, [], -1))).toBe(false);
  });

  it('offers a live choice only with two audio tracks or a subtitle', () => {
    expect(hasTrackChoice(null)).toBe(false);
    expect(hasTrackChoice(fromHls([{ lang: 'en' }], 0, [], -1))).toBe(false);
    expect(hasTrackChoice(fromHls([{ lang: 'en' }, { lang: 'ar' }], 0, [], -1))).toBe(true);
    expect(hasTrackChoice(fromHls([{ lang: 'en' }], 0, [{ lang: 'en' }], -1))).toBe(true);
  });
});
