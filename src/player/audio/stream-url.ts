/**
 * The audio stream URL: GET /Audio/{id}/universal. The server direct-plays
 * the file when its container and codec are in our device profile (it
 * redirects to the static file) and transcodes to mp3 over plain HTTP
 * otherwise. Auth is `ApiKey=` in the query, the only URL form Jellyfin 12
 * accepts. Pure, so it is unit-tested.
 */
import type { DeviceProfile, PlayMethod } from '@/api/types';

import { absolute, type StreamServer, withStreamAuth } from '../stream';

export interface AudioStreamOptions {
  userId: string;
  maxBitrate: number;
  playSessionId: string;
  /** Start of a transcoded stream, in ticks. Direct play seeks in the file instead. */
  startTicks?: number;
}

/**
 * The universal endpoint's `Container` list from the profile's audio
 * direct-play entries: "mp3,aac|aac,m4a|aac,flac|flac" (container or
 * container|codec).
 */
export function universalContainers(profile: DeviceProfile): string {
  const out: string[] = [];
  for (const p of profile.DirectPlayProfiles ?? []) {
    if (p.Type !== 'Audio' || !p.Container) continue;
    const codecs = (p.AudioCodec ?? '').split(',').filter(Boolean);
    for (const container of p.Container.split(',').filter(Boolean)) {
      if (!codecs.length || (codecs.length === 1 && codecs[0] === container)) out.push(container);
      else for (const codec of codecs) out.push(`${container}|${codec}`);
    }
  }
  return [...new Set(out)].join(',');
}

function transcodeProfile(profile: DeviceProfile) {
  return profile.TranscodingProfiles?.find((t) => t.Type === 'Audio') ?? null;
}

export function universalAudioUrl(server: StreamServer, itemId: string, profile: DeviceProfile, o: AudioStreamOptions): string {
  const t = transcodeProfile(profile);
  const params: Record<string, string> = {
    UserId: o.userId,
    DeviceId: server.deviceId,
    MaxStreamingBitrate: String(Math.round(o.maxBitrate)),
    Container: universalContainers(profile),
    TranscodingContainer: t?.Container ?? 'mp3',
    TranscodingProtocol: t?.Protocol === 'hls' ? 'hls' : 'http',
    AudioCodec: t?.AudioCodec ?? 'mp3',
    MaxAudioChannels: t?.MaxAudioChannels ?? '2',
    PlaySessionId: o.playSessionId,
    EnableRedirection: 'true',
    EnableRemoteMedia: 'false',
  };
  if (o.startTicks && o.startTicks > 0) params.StartTimeTicks = String(Math.round(o.startTicks));
  const q = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return withStreamAuth(absolute(server.baseUrl, `/Audio/${encodeURIComponent(itemId)}/universal?${q}`), server.token);
}

interface AudioItemLike {
  Container?: string | null;
  MediaSources?: readonly {
    Container?: string | null;
    Bitrate?: number | null;
    MediaStreams?: readonly { Type?: string | null; Codec?: string | null; BitRate?: number | null }[] | null;
  }[] | null;
  MediaStreams?: readonly { Type?: string | null; Codec?: string | null; BitRate?: number | null }[] | null;
}

/**
 * What the server will do with this file: direct play when the container and
 * codec match a direct-play entry and the bitrate fits, else a transcode.
 * Used for the progress reports and the format line; when the file facts are
 * missing, it assumes direct play.
 */
export function predictPlayMethod(item: AudioItemLike, profile: DeviceProfile, maxBitrate: number): PlayMethod {
  const source = item.MediaSources?.[0];
  const container = (source?.Container ?? item.Container ?? '').toLowerCase().split(',')[0] ?? '';
  const streams = source?.MediaStreams ?? item.MediaStreams ?? [];
  const audio = streams.find((s) => s.Type === 'Audio');
  const codec = (audio?.Codec ?? '').toLowerCase();
  if (!container) return 'DirectPlay';
  const bitrate = source?.Bitrate ?? audio?.BitRate ?? 0;
  if (bitrate && bitrate > maxBitrate) return 'Transcode';
  const ok = (profile.DirectPlayProfiles ?? []).some((p) => {
    if (p.Type !== 'Audio') return false;
    const containers = (p.Container ?? '').toLowerCase().split(',');
    const codecs = (p.AudioCodec ?? '').toLowerCase().split(',').filter(Boolean);
    return containers.includes(container) && (!codec || !codecs.length || codecs.includes(codec));
  });
  return ok ? 'DirectPlay' : 'Transcode';
}

/** "MP3 · 128 kbps", "FLAC · 24/96" for the line under the scrubber. Null when unknown. */
export function formatLine(item: AudioItemLike): string | null {
  const source = item.MediaSources?.[0];
  const streams = source?.MediaStreams ?? item.MediaStreams ?? [];
  const audio = streams.find((s) => s.Type === 'Audio') as
    | { Codec?: string | null; BitRate?: number | null; BitDepth?: number | null; SampleRate?: number | null }
    | undefined;
  const codec = audio?.Codec?.toUpperCase() ?? (source?.Container ?? item.Container ?? '').split(',')[0]?.toUpperCase();
  if (!codec) return null;
  const lossless = /FLAC|ALAC|WAV|PCM/.test(codec);
  if (lossless && audio?.BitDepth && audio.SampleRate) {
    return `${codec} · ${audio.BitDepth}/${Math.round(audio.SampleRate / 1000)}`;
  }
  const kbps = audio?.BitRate ?? source?.Bitrate;
  return kbps ? `${codec} · ${Math.round(kbps / 1000)} kbps` : codec;
}
