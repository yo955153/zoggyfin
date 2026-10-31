/**
 * Which stream URL to play for a channel on this platform. Xtream live gives
 * HLS (`.m3u8`) on iOS and the web and MPEG-TS (`.ts`) on Android and the
 * Mac app (ExoPlayer and libmpv read both). AVPlayer and browsers cannot play
 * a plain `.ts` stream: an M3U entry in the Xtream panel shape is tried as
 * HLS first, and else the channel says that its format does not play here.
 * URLs hold credentials: nothing here logs them. Pure, so it is unit-tested.
 */
import type { Channel, LiveStream, ProviderKind, StreamChoice } from './types';
import { type XtreamLogin, xtreamLiveUrl } from './xtream';

/** `ios` includes iPadOS; `tvos` is Apple TV; `desktop` is the Mac app (libmpv). */
export type StreamPlatform = 'ios' | 'tvos' | 'android' | 'web' | 'desktop';

/** True for the platforms that cannot play a progressive MPEG-TS stream. */
export function needsHls(platform: StreamPlatform): boolean {
  return platform === 'ios' || platform === 'tvos' || platform === 'web';
}

/** The Xtream live format for the platform. */
export function xtreamExtFor(platform: StreamPlatform): 'm3u8' | 'ts' {
  return needsHls(platform) ? 'm3u8' : 'ts';
}

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

/** True when the URL names an HLS playlist (by its extension or a common query flag). */
export function isHlsUrl(url: string): boolean {
  if (/\.m3u8?$/i.test(pathOf(url))) return true;
  return /[?&](extension|output|type|format)=(m3u8|hls)(&|$)/i.test(url);
}

/** True when the URL names a plain MPEG-TS stream. */
export function isTsUrl(url: string): boolean {
  return /\.ts$/i.test(pathOf(url)) || /[?&](extension|output|type|format)=(ts|mpegts)(&|$)/i.test(url);
}

const XTREAM_SHAPE = /^(https?:\/\/[^/?#]+)((?:\/live)?\/[^/?#]+\/[^/?#]+\/\d+)(\.ts)?(\?[^#]*)?$/i;

/**
 * The HLS form of an Xtream panel stream URL: `http://host[:port]/[live/]user/pass/123[.ts]`
 * becomes the same path with `.m3u8`. Null for any other URL.
 */
export function xtreamHlsForm(url: string): string | null {
  const m = XTREAM_SHAPE.exec(url.trim());
  if (!m) return null;
  return `${m[1]}${m[2]}.m3u8${m[4] ?? ''}`;
}

/** The message when no stream form plays on this platform. */
export function unsupportedFormatText(platform: StreamPlatform): string {
  if (platform === 'web') return "This channel's format does not play in a browser. Use the app on a phone, a TV or a Mac.";
  if (platform === 'tvos') return "This channel's format does not play on Apple TV.";
  return "This channel's format does not play on iPhone and iPad.";
}

/** The streams to try for a channel, in order, and what to say when none plays. */
export function liveStreamFor(
  channel: Channel,
  provider: { kind: ProviderKind; userAgent: string | null },
  login: XtreamLogin | null,
  platform: StreamPlatform,
  /** The iOS TS bridge is in this binary: a progressive .ts stream can play through it. */
  tsBridge = false,
): LiveStream {
  const userAgent = channel.userAgent ?? provider.userAgent ?? null;
  if (provider.kind === 'xtream') {
    if (!login || channel.streamId === undefined) return { candidates: [], userAgent, unsupported: 'This channel has no stream.' };
    const ext = xtreamExtFor(platform);
    return { candidates: [{ url: xtreamLiveUrl(login, channel.streamId, ext), isHls: ext === 'm3u8' }], userAgent, unsupported: null };
  }
  const url = channel.url;
  if (!url) return { candidates: [], userAgent, unsupported: 'This channel has no stream.' };
  if (isHlsUrl(url)) return { candidates: [{ url, isHls: true }], userAgent, unsupported: null };
  if (!needsHls(platform)) return { candidates: [{ url, isHls: false }], userAgent, unsupported: null };
  const hls = xtreamHlsForm(url);
  const candidates: StreamChoice[] = hls ? [{ url: hls, isHls: true }] : [];
  // The HLS form first (no bridge work when the panel serves it), then the bridge on iOS.
  if ((isTsUrl(url) || hls) && tsBridge && platform === 'ios') candidates.push({ url, isHls: true, bridge: true });
  if (isTsUrl(url) || hls) return { candidates, userAgent, unsupported: unsupportedFormatText(platform) };
  // An unknown format: try it as it is; the player says what failed.
  return { candidates: [{ url, isHls: false }], userAgent, unsupported: null };
}
