import { chapterAt, chapterMarks, chaptersOf, formatTime, pickTrickplay, spokenTime, trickplaySheetUrl, trickplayTile } from '../timeline';
import { cuesAt, parseVtt } from '../vtt';

const map = {
  src1: {
    '160': { Width: 160, Height: 90, TileWidth: 10, TileHeight: 10, ThumbnailCount: 250, Interval: 10000 },
    '320': { Width: 320, Height: 180, TileWidth: 10, TileHeight: 10, ThumbnailCount: 250, Interval: 10000 },
  },
};

describe('trickplay', () => {
  it('picks the width closest to the preferred size', () => {
    expect(pickTrickplay(map, 'src1', 300)?.width).toBe(320);
    expect(pickTrickplay(map, 'src1', 100)?.width).toBe(160);
    expect(pickTrickplay(null, 'src1')).toBeNull();
    expect(pickTrickplay({}, 'src1')).toBeNull();
  });
  it('finds the sheet and the offset of a thumbnail', () => {
    const t = pickTrickplay(map, 'src1', 320);
    if (!t) throw new Error('no trickplay');
    expect(trickplayTile(t, 0)).toEqual({ sheet: 0, x: 0, y: 0 });
    // Index 123 = sheet 1, local 23 -> column 3, row 2.
    expect(trickplayTile(t, 1235)).toEqual({ sheet: 1, x: 960, y: 360 });
    // Past the end clamps to the last thumbnail (index 249).
    expect(trickplayTile(t, 99999)).toEqual({ sheet: 2, x: 2880, y: 720 });
    expect(trickplaySheetUrl({ baseUrl: 'http://h/', token: 'k' }, 'it', 'src1', t, 1)).toBe(
      'http://h/Videos/it/Trickplay/320/1.jpg?MediaSourceId=src1&ApiKey=k',
    );
  });
});

describe('chapters', () => {
  const ch = chaptersOf(
    [
      { StartPositionTicks: 0, Name: 'Opening' },
      { StartPositionTicks: 600 * 1e7, Name: '' },
      { StartPositionTicks: 300 * 1e7, Name: 'Middle' },
    ],
    1200,
  );
  it('sorts and names chapters', () => {
    expect(ch.map((c) => c.name)).toEqual(['Opening', 'Middle', 'Chapter 2']);
  });
  it('finds the current chapter', () => {
    expect(chapterAt(ch, 450)?.name).toBe('Middle');
    expect(chapterAt(ch, 0)?.name).toBe('Opening');
  });
  it('marks chapters as fractions, without the one at 0', () => {
    expect(chapterMarks(ch, 1200)).toEqual([0.25, 0.5]);
    expect(chapterMarks(ch, 0)).toEqual([]);
  });
});

describe('time text', () => {
  it('formats clock and remaining time', () => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(-30)).toBe('−0:30');
  });
  it('speaks time for VoiceOver', () => {
    expect(spokenTime(94)).toBe('1 minute 34 seconds');
    expect(spokenTime(3601)).toBe('1 hour 1 second');
  });
});

describe('WebVTT', () => {
  const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500 line:90%
<i>Hello</i> &amp; welcome

00:02.000 --> 00:04.000
Second

00:00:10,000 --> 00:00:09,000
Broken
`;
  it('parses cues, strips tags and decodes entities', () => {
    const cues = parseVtt(vtt);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'Hello & welcome' },
      { start: 2, end: 4, text: 'Second' },
    ]);
  });
  it('finds overlapping cues at a time', () => {
    const cues = parseVtt(vtt);
    expect(cuesAt(cues, 0.5)).toEqual([]);
    expect(cuesAt(cues, 2.5)).toEqual(['Hello & welcome', 'Second']);
    expect(cuesAt(cues, 3.8)).toEqual(['Second']);
    expect(cuesAt(cues, 5)).toEqual([]);
  });
});
