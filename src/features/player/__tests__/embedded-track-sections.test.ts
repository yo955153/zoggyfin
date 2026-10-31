import { embeddedTrackSections } from '../embedded-track-sections';

describe('embeddedTrackSections', () => {
  it('lists the audio tracks and Off plus the subtitles, with the selection', () => {
    const select = { audio: jest.fn(), subtitle: jest.fn() };
    const [audio, subs] = embeddedTrackSections(
      {
        audio: [
          { id: '0', title: null, language: 'en', codec: 'ac3', isDefault: true, isForced: false },
          { id: '1', title: null, language: 'fr', codec: null, isDefault: false, isForced: false },
        ],
        subtitles: [{ id: '3', title: null, language: 'fr', codec: null, isDefault: false, isForced: true }],
        audioId: '1',
        subtitleId: null,
      },
      select,
    );
    expect(audio.rows.map((r) => [r.label, r.detail, r.selected])).toEqual([
      ['English · AC3', 'Default', false],
      ['French', null, true],
    ]);
    expect(subs.rows.map((r) => [r.label, r.selected])).toEqual([
      ['Off', true],
      ['French (Forced)', false],
    ]);
    audio.rows[0].onPress();
    subs.rows[1].onPress();
    subs.rows[0].onPress();
    expect(select.audio).toHaveBeenCalledWith('0');
    expect(select.subtitle).toHaveBeenNthCalledWith(1, '3');
    expect(select.subtitle).toHaveBeenNthCalledWith(2, null);
  });

  it('shows empty sections when the engine lists nothing', () => {
    const [audio, subs] = embeddedTrackSections(null, { audio: jest.fn(), subtitle: jest.fn() });
    expect(audio.rows).toEqual([]);
    expect(audio.empty).toBeTruthy();
    expect(subs.rows).toEqual([]);
    expect(subs.empty).toBe('No subtitles in this stream');
  });
});
