import { absolute, audioSwitchNeedsStream, directPlayUrl, pickSource, planStream, playbackInfoBody, withStreamAuth, type MediaSource } from '../stream';

const server = { baseUrl: 'http://media.example.test:8096', token: 'tok123', deviceId: 'dev-1' };

const direct: MediaSource = {
  Id: 'src1',
  Container: 'mp4',
  ETag: 'etag1',
  SupportsDirectPlay: true,
  SupportsDirectStream: true,
  DefaultAudioStreamIndex: 1,
  MediaStreams: [
    { Type: 'Video', Index: 0 },
    { Type: 'Audio', Index: 1, DisplayTitle: 'English AAC', Language: 'eng', IsDefault: true },
    { Type: 'Audio', Index: 2, DisplayTitle: 'French AC3', Language: 'fre' },
    { Type: 'Subtitle', Index: 3, DisplayTitle: 'English', IsTextSubtitleStream: true, DeliveryMethod: 'External', DeliveryUrl: '/Videos/x/src1/Subtitles/3/0/Stream.vtt?api_key=old' },
    { Type: 'Subtitle', Index: 4, DisplayTitle: 'PGS', IsTextSubtitleStream: false, DeliveryMethod: 'Encode' },
  ],
};

describe('withStreamAuth', () => {
  it('replaces legacy keys with ApiKey', () => {
    expect(withStreamAuth('/a?x=1&api_key=old&ApiKey=old2', 't')).toBe('/a?x=1&ApiKey=t');
  });
  it('adds a query when there is none', () => {
    expect(withStreamAuth('/a', 't k')).toBe('/a?ApiKey=t%20k');
  });
  it('leaves the URL alone without a token', () => {
    expect(withStreamAuth('/a?api_key=x', null)).toBe('/a');
  });
});

describe('absolute', () => {
  it('joins without double slashes', () => {
    expect(absolute('http://h/', '/videos/1')).toBe('http://h/videos/1');
    expect(absolute('http://h', 'videos/1')).toBe('http://h/videos/1');
  });
  it('keeps absolute URLs', () => {
    expect(absolute('http://h', 'https://cdn/x')).toBe('https://cdn/x');
  });
});

describe('directPlayUrl', () => {
  it('builds the static stream URL', () => {
    const url = directPlayUrl(server, 'item1', direct, 'ps1');
    expect(url).toBe(
      'http://media.example.test:8096/Videos/item1/stream.mp4?static=true&mediaSourceId=src1&playSessionId=ps1&deviceId=dev-1&Tag=etag1&ApiKey=tok123',
    );
  });
  it('prefers a server DirectStreamUrl (Jellyfin 12)', () => {
    const url = directPlayUrl(server, 'item1', { ...direct, DirectStreamUrl: '/Videos/item1/stream?static=true' }, 'ps1');
    expect(url).toBe('http://media.example.test:8096/Videos/item1/stream?static=true&ApiKey=tok123');
  });
});

describe('planStream', () => {
  it('direct plays when the server allows it', () => {
    const plan = planStream(server, 'item1', direct, 'ps1');
    expect(plan.playMethod).toBe('DirectPlay');
    expect(plan.isHls).toBe(false);
    expect(plan.mediaSourceId).toBe('src1');
    expect(plan.playSessionId).toBe('ps1');
    expect(plan.audioIndex).toBe(1);
    expect(plan.subtitleIndex).toBeNull();
  });

  it('uses the TranscodingUrl with fresh auth when transcoding', () => {
    const src: MediaSource = {
      ...direct,
      SupportsDirectPlay: false,
      SupportsDirectStream: false,
      TranscodingSubProtocol: 'hls',
      TranscodingUrl: '/videos/item1/master.m3u8?MediaSourceId=src1&ApiKey=old&SubtitleStreamIndex=4',
    };
    const plan = planStream(server, 'item1', src, 'ps2', { subtitleIndex: 4 });
    expect(plan.playMethod).toBe('Transcode');
    expect(plan.isHls).toBe(true);
    expect(plan.url).toBe('http://media.example.test:8096/videos/item1/master.m3u8?MediaSourceId=src1&SubtitleStreamIndex=4&ApiKey=tok123');
    expect(plan.burnedSubtitle).toBe(true);
  });

  it('lists audio and subtitle tracks with WebVTT URLs', () => {
    const plan = planStream(server, 'item1', direct, 'ps1');
    expect(plan.audio.map((a) => a.label)).toEqual(['English AAC', 'French AC3']);
    expect(plan.subtitles[0]).toMatchObject({ index: 3, isText: true });
    expect(plan.subtitles[0]?.url).toBe('http://media.example.test:8096/Videos/x/src1/Subtitles/3/0/Stream.vtt?ApiKey=tok123');
    expect(plan.subtitles[1]).toMatchObject({ index: 4, isText: false, url: null });
  });

  it('throws when nothing can stream', () => {
    expect(() => planStream(server, 'i', { ...direct, SupportsDirectPlay: false, SupportsDirectStream: false }, null)).toThrow();
  });
});

describe('audioSwitchNeedsStream', () => {
  const plan = planStream(server, 'item1', direct, 'ps1');
  it('needs a remux for a non-default track on direct play', () => {
    expect(audioSwitchNeedsStream(plan, 2)).toBe(true);
    expect(audioSwitchNeedsStream(plan, 1)).toBe(false);
  });
  it('always asks the server when transcoding', () => {
    expect(audioSwitchNeedsStream({ ...plan, playMethod: 'Transcode' }, 1)).toBe(true);
  });
});

describe('playbackInfoBody', () => {
  it('turns subtitles off with -1 and can force a stream', () => {
    const body = playbackInfoBody({ userId: 'u', profile: {}, maxBitrate: 1, forceStream: true });
    expect(body.SubtitleStreamIndex).toBe(-1);
    expect(body.EnableDirectPlay).toBe(false);
    expect(body.EnableTranscoding).toBe(true);
  });
});

describe('pickSource', () => {
  it('picks by id, else the first', () => {
    const a = { Id: 'a' };
    const b = { Id: 'b' };
    expect(pickSource([a, b], 'b')).toBe(b);
    expect(pickSource([a, b], 'zz')).toBe(a);
    expect(pickSource([], 'a')).toBeNull();
  });
});
