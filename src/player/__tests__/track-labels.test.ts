import type { EmbeddedTrack } from '../engine-types';
import { baseLanguage, codecName, embeddedTrackLabel, embeddedTrackLabels, isImageSubtitle, languageName } from '../track-labels';

const track = (p: Partial<EmbeddedTrack>): EmbeddedTrack => ({ id: '0', title: null, language: null, codec: null, isDefault: false, isForced: false, ...p });

describe('languageName', () => {
  it('names ISO 639-1 and both ISO 639-2 forms', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('eng')).toBe('English');
    expect(languageName('fre')).toBe('French');
    expect(languageName('fra')).toBe('French');
    expect(languageName('GER')).toBe('German');
    expect(languageName('ara')).toBe('Arabic');
  });

  it('keeps the region where it changes the name', () => {
    expect(languageName('pt-BR')).toBe('Portuguese (Brazil)');
    expect(languageName('es_419')).toBe('Spanish (Latin America)');
    expect(languageName('fr-BE')).toBe('French');
  });

  it('gives no name for undetermined or unknown codes', () => {
    expect(languageName('und')).toBeNull();
    expect(languageName('zxx')).toBeNull();
    expect(languageName('qaa')).toBeNull();
    expect(languageName('')).toBeNull();
    expect(languageName(null)).toBeNull();
    expect(baseLanguage('und')).toBeNull();
    expect(baseLanguage('dut')).toBe('nl');
  });
});

describe('codecName', () => {
  it('names audio and subtitle codecs from libmpv, hls.js and MIME types', () => {
    expect(codecName('ac3')).toBe('AC3');
    expect(codecName('ec-3')).toBe('E-AC3');
    expect(codecName('mp4a.40.2')).toBe('AAC');
    expect(codecName('mp4a.40.34')).toBe('AAC');
    expect(codecName('audio/mp4a-latm')).toBeNull();
    expect(codecName('subrip')).toBe('SRT');
    expect(codecName('hdmv_pgs_subtitle')).toBe('PGS');
    expect(codecName(null)).toBeNull();
  });

  it('knows picture subtitles', () => {
    expect(isImageSubtitle('hdmv_pgs_subtitle')).toBe(true);
    expect(isImageSubtitle('dvb_subtitle')).toBe(true);
    expect(isImageSubtitle('subrip')).toBe(false);
    expect(isImageSubtitle(null)).toBe(false);
  });
});

describe('embeddedTrackLabel', () => {
  it('names the language', () => {
    expect(embeddedTrackLabel(track({ language: 'eng' }), 'audio', 1)).toBe('English');
  });

  it('marks forced subtitles', () => {
    expect(embeddedTrackLabel(track({ language: 'fre', isForced: true }), 'subtitle', 1)).toBe('French (Forced)');
  });

  it('adds the codec when known', () => {
    expect(embeddedTrackLabel(track({ language: 'ar', codec: 'ac3' }), 'audio', 1)).toBe('Arabic · AC3');
  });

  it('adds a title that says more than the language', () => {
    expect(embeddedTrackLabel(track({ language: 'en', title: 'Commentary' }), 'audio', 1)).toBe('English · Commentary');
    expect(embeddedTrackLabel(track({ language: 'en', title: 'English' }), 'audio', 1)).toBe('English');
    expect(embeddedTrackLabel(track({ language: 'en', title: 'eng' }), 'audio', 1)).toBe('English');
    expect(embeddedTrackLabel(track({ language: 'en', title: 'English SDH' }), 'subtitle', 1)).toBe('English SDH');
  });

  it('uses the title when the language is undetermined', () => {
    expect(embeddedTrackLabel(track({ language: 'und', title: 'Director' }), 'audio', 1)).toBe('Director');
  });

  it('falls back to the number', () => {
    expect(embeddedTrackLabel(track({}), 'audio', 2)).toBe('Track 2');
    expect(embeddedTrackLabel(track({ language: 'und' }), 'subtitle', 3)).toBe('Subtitle 3');
  });

  it('numbers tracks that would have the same label', () => {
    const labels = embeddedTrackLabels([track({ language: 'en' }), track({ language: 'en' }), track({ language: 'fr' })], 'audio');
    expect(labels).toEqual(['English · Track 1', 'English · Track 2', 'French']);
  });
});
