import type { EmbeddedTrack, EmbeddedTracks } from '../engine-types';
import { chooseTracks, EMPTY_TRACK_PREFS, MAX_TITLES, matchPick, migrateTrackPrefs, rememberChoice, titleKey, toPick } from '../track-prefs';

const t = (id: string, p: Partial<EmbeddedTrack> = {}): EmbeddedTrack => ({ id, title: null, language: null, codec: null, isDefault: false, isForced: false, ...p });

const film: EmbeddedTracks = {
  audio: [t('a0', { language: 'eng', isDefault: true, codec: 'ac3' }), t('a1', { language: 'fre' }), t('a2', { language: 'eng', title: 'Commentary' })],
  subtitles: [t('s0', { language: 'eng', isForced: true }), t('s1', { language: 'eng' }), t('s2', { language: 'fre' })],
  audioId: 'a0',
  subtitleId: null,
};

const KEY = titleKey('p1', { kind: 'film', id: '42' });

describe('chooseTracks', () => {
  it('with no choice: the default audio stays, and a forced subtitle in the audio language shows', () => {
    expect(chooseTracks(film, EMPTY_TRACK_PREFS, KEY)).toEqual({ subtitleId: 's0' });
  });

  it('with no choice and no forced subtitle: a default subtitle, else none', () => {
    const tracks = { ...film, subtitles: [t('s1', { language: 'eng' }), t('s2', { language: 'fre', isDefault: true })] };
    expect(chooseTracks(tracks, EMPTY_TRACK_PREFS, KEY)).toEqual({ subtitleId: 's2' });
    expect(chooseTracks({ ...film, subtitles: [t('s1', { language: 'eng' })] }, EMPTY_TRACK_PREFS, KEY)).toEqual({});
  });

  it("uses the title's own choice first", () => {
    let prefs = rememberChoice(EMPTY_TRACK_PREFS, KEY, 'audio', film.audio[2], 1);
    prefs = rememberChoice(prefs, KEY, 'subtitle', film.subtitles[2], 2);
    expect(chooseTracks(film, prefs, KEY)).toEqual({ audioId: 'a2', subtitleId: 's2' });
  });

  it('keeps subtitles off for a title where they were turned off', () => {
    const prefs = rememberChoice({ ...EMPTY_TRACK_PREFS, subtitleLanguage: 'fr' }, KEY, 'subtitle', null, 1);
    expect(chooseTracks({ ...film, subtitleId: 's1' }, prefs, KEY)).toEqual({ subtitleId: null });
  });

  it('uses the languages picked last for a new title', () => {
    const prefs = { ...EMPTY_TRACK_PREFS, audioLanguage: 'fr', subtitleLanguage: 'en' };
    expect(chooseTracks(film, prefs, titleKey('p1', { kind: 'film', id: 'other' }))).toEqual({ audioId: 'a1', subtitleId: 's1' });
  });

  it('shows only a forced subtitle when subtitles are off in general', () => {
    const prefs = { ...EMPTY_TRACK_PREFS, subtitleLanguage: 'off' as const };
    expect(chooseTracks({ ...film, subtitleId: 's1' }, prefs, KEY)).toEqual({ subtitleId: 's0' });
  });

  it('leaves the engine alone when the preferred language is missing', () => {
    const prefs = { ...EMPTY_TRACK_PREFS, audioLanguage: 'de', subtitleLanguage: 'de' };
    const tracks = { ...film, subtitles: [t('s1', { language: 'eng' })] };
    expect(chooseTracks(tracks, prefs, KEY)).toEqual({});
  });

  it('a series shares one choice for all its episodes', () => {
    const series = titleKey('p1', { kind: 'series', id: 's9' });
    const prefs = rememberChoice(EMPTY_TRACK_PREFS, series, 'audio', film.audio[1], 1);
    // The next episode lists its tracks with other ids.
    const next: EmbeddedTracks = { audio: [t('x', { language: 'en' }), t('y', { language: 'fr' })], subtitles: [], audioId: 'x', subtitleId: null };
    expect(chooseTracks(next, prefs, series)).toEqual({ audioId: 'y' });
  });
});

describe('matchPick', () => {
  it('prefers the same title and forced flag in the language', () => {
    expect(matchPick(film.audio, toPick(film.audio[2]))?.id).toBe('a2');
    expect(matchPick(film.subtitles, toPick(film.subtitles[0]))?.id).toBe('s0');
    expect(matchPick(film.subtitles, { language: 'en', title: null, codec: null, forced: false })?.id).toBe('s1');
  });

  it('matches a track with no language only by title', () => {
    const list = [t('1', { title: 'Main' }), t('2', { title: 'Director' })];
    expect(matchPick(list, { language: null, title: 'director', codec: null, forced: false })?.id).toBe('2');
    expect(matchPick(list, { language: null, title: null, codec: null, forced: false })).toBeNull();
  });
});

describe('rememberChoice', () => {
  it('keeps the languages, but not from a forced subtitle', () => {
    let prefs = rememberChoice(EMPTY_TRACK_PREFS, KEY, 'audio', film.audio[1], 1);
    expect(prefs.audioLanguage).toBe('fr');
    prefs = rememberChoice(prefs, KEY, 'subtitle', film.subtitles[0], 2);
    expect(prefs.subtitleLanguage).toBeNull();
    prefs = rememberChoice(prefs, KEY, 'subtitle', film.subtitles[1], 3);
    expect(prefs.subtitleLanguage).toBe('en');
    prefs = rememberChoice(prefs, KEY, 'subtitle', null, 4);
    expect(prefs.subtitleLanguage).toBe('off');
    expect(prefs.titles[KEY]).toMatchObject({ at: 4, subtitle: 'off', audio: { language: 'fre' } });
  });

  it('does not change the input', () => {
    const before = JSON.stringify(EMPTY_TRACK_PREFS);
    rememberChoice(EMPTY_TRACK_PREFS, KEY, 'audio', film.audio[1], 1);
    expect(JSON.stringify(EMPTY_TRACK_PREFS)).toBe(before);
  });

  it('drops the oldest titles past the limit', () => {
    let prefs = EMPTY_TRACK_PREFS;
    for (let i = 0; i <= MAX_TITLES; i++) prefs = rememberChoice(prefs, `k${i}`, 'subtitle', null, i);
    expect(Object.keys(prefs.titles)).toHaveLength(MAX_TITLES);
    expect(prefs.titles.k0).toBeUndefined();
    expect(prefs.titles[`k${MAX_TITLES}`]).toBeDefined();
  });
});

describe('migrateTrackPrefs', () => {
  it('never throws, and keeps what is valid', () => {
    expect(migrateTrackPrefs(null)).toBe(EMPTY_TRACK_PREFS);
    expect(migrateTrackPrefs('x')).toBe(EMPTY_TRACK_PREFS);
    expect(migrateTrackPrefs({ version: 9 })).toBe(EMPTY_TRACK_PREFS);
    const saved = rememberChoice(rememberChoice(EMPTY_TRACK_PREFS, KEY, 'audio', film.audio[1], 1), KEY, 'subtitle', null, 2);
    expect(migrateTrackPrefs(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    const odd = migrateTrackPrefs({ version: 1, audioLanguage: 5, subtitleLanguage: 'off', titles: { a: 3, b: { audio: 'x', subtitle: { language: 'en' } } } });
    expect(odd).toEqual({ version: 1, audioLanguage: null, subtitleLanguage: 'off', titles: { b: { at: 0, subtitle: { language: 'en', title: null, codec: null, forced: false } } } });
  });
});
