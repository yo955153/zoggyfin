import type { CodecProfile, DeviceProfile } from '@/api/types';

import { appleCapabilities, buildDeviceProfile, webCapabilities } from '../device-profile';

const opts = { maxBitrate: 20_000_000 };

function videoDirect(p: DeviceProfile) {
  return (p.DirectPlayProfiles ?? []).filter((d) => d.Type === 'Video');
}
function codec(p: DeviceProfile, name: string): CodecProfile | undefined {
  return (p.CodecProfiles ?? []).find((c) => c.Codec === name);
}

describe('Apple device profile', () => {
  const noAv1 = buildDeviceProfile(appleCapabilities({ av1: false, hevc: true }), opts);
  const av1 = buildDeviceProfile(appleCapabilities({ av1: true, hevc: true }), opts);

  it('direct plays mp4, m4v and mov with h264 and hevc', () => {
    const [dp] = videoDirect(noAv1);
    expect(dp?.Container).toBe('mp4,m4v,mov');
    expect(dp?.VideoCodec).toBe('h264,hevc');
    expect(dp?.AudioCodec).toBe('aac,ac3,eac3,mp3,flac,alac');
  });

  it('lists AV1 only with a hardware decoder', () => {
    expect(videoDirect(noAv1)[0]?.VideoCodec).not.toContain('av1');
    expect(videoDirect(av1)[0]?.VideoCodec).toContain('av1');
    expect(codec(noAv1, 'av1')).toBeUndefined();
    expect(codec(av1, 'av1')).toBeDefined();
  });

  it('excludes Dolby Vision profile 5 and requires the hvc1 tag for hevc', () => {
    const hevc = codec(noAv1, 'hevc');
    const range = hevc?.Conditions?.find((c) => c.Property === 'VideoRangeType')?.Value ?? '';
    expect(range.split('|')).not.toContain('DOVI');
    expect(range.split('|')).toContain('DOVIWithHDR10');
    const tag = hevc?.Conditions?.find((c) => c.Property === 'VideoCodecTag');
    expect(tag).toMatchObject({ Condition: 'EqualsAny', Value: 'hvc1|dvh1', IsRequired: true });
  });

  it('transcodes to HLS with fMP4 segments, hevc first', () => {
    const t = (noAv1.TranscodingProfiles ?? []).find((x) => x.Type === 'Video');
    expect(t).toMatchObject({ Protocol: 'hls', Container: 'mp4', Context: 'Streaming', VideoCodec: 'hevc,h264' });
  });

  it('uses MPEG-TS segments when the device has no HEVC', () => {
    const p = buildDeviceProfile(appleCapabilities({ av1: false, hevc: false }), opts);
    expect((p.TranscodingProfiles ?? [])[0]).toMatchObject({ Container: 'ts', VideoCodec: 'h264' });
  });

  it('carries the bitrate limit', () => {
    expect(noAv1.MaxStreamingBitrate).toBe(20_000_000);
    expect(noAv1.MaxStaticBitrate).toBe(20_000_000);
  });

  it('delivers text subtitles as external WebVTT and burns in image subtitles', () => {
    const subs = noAv1.SubtitleProfiles ?? [];
    expect(subs).toContainEqual({ Format: 'vtt', Method: 'External' });
    for (const f of ['pgssub', 'dvdsub', 'dvbsub']) expect(subs).toContainEqual({ Format: f, Method: 'Encode' });
  });

  it('does not reject anamorphic video', () => {
    const all = (noAv1.CodecProfiles ?? []).flatMap((c) => c.Conditions ?? []);
    expect(all.some((c) => c.Property === 'IsAnamorphic')).toBe(false);
  });
});

describe('web device profile', () => {
  const chrome = webCapabilities({
    canPlay: (m) => /avc1|mp4a|audio\/mpeg|vp09|av01|webm|opus|flac/.test(m),
    canMse: (m) => /avc1|mp4a|hvc1/.test(m),
    nativeHls: false,
  });
  const safari = webCapabilities({
    canPlay: (m) => /avc1|hvc1|mp4a|audio\/mpeg|ac-3|ec-3|flac|alac|mpegurl/.test(m),
    canMse: () => true,
    nativeHls: true,
  });

  it('probes direct-play codecs from the browser', () => {
    expect(chrome.videoCodecs).toEqual(['h264', 'av1', 'vp9']);
    expect(chrome.containers).toContain('webm');
    expect(safari.videoCodecs).toEqual(['h264', 'hevc']);
  });

  it('uses hls.js codecs when the browser has no native HLS', () => {
    expect(chrome.hls).toBe(true);
    expect(chrome.hlsVideoCodecs).toEqual(['hevc', 'h264']);
    expect(chrome.maxAudioChannels).toBe(2);
  });

  it('builds a webm direct-play entry for VP9 and AV1', () => {
    const p = buildDeviceProfile(chrome, opts);
    const webm = (p.DirectPlayProfiles ?? []).find((d) => d.Container === 'webm');
    expect(webm?.VideoCodec).toBe('av1,vp9');
    expect(webm?.AudioCodec).toBe('opus');
  });

  it('falls back to h264 when nothing probes', () => {
    const none = webCapabilities({ canPlay: () => false, canMse: () => false, nativeHls: false });
    expect(none.videoCodecs).toEqual(['h264']);
    expect(none.hls).toBe(false);
  });
});
