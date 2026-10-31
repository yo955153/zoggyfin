/**
 * Which stream to play for a film or an episode on this platform. Xtream
 * serves the file in its own container (`container_extension`):
 *
 * - Android (ExoPlayer) and the Mac app (libmpv) play MP4, MKV, AVI, TS and HLS.
 * - iPhone, iPad and Apple TV (AVPlayer) play MP4, M4V, MOV and HLS only. For
 *   any other container the HLS form of the same path (`<id>.m3u8`) is tried:
 *   some panels make one. When it fails, the player says why.
 * - Browsers play MP4, M4V, MOV, WebM and HLS; Chrome and Edge also play many
 *   MKV files (H.264 or HEVC with AAC). Other containers try the HLS form.
 *
 * URLs hold credentials: nothing here logs them. Pure, so it is unit-tested.
 */
import type { LiveStream, StreamChoice } from './types';
import type { StreamPlatform } from './stream-url';
import type { Episode, Film } from './vod-types';
import { type XtreamLogin } from './xtream';
import { cleanExt, xtreamEpisodeUrl, xtreamFilmUrl } from './xtream-vod';

/** Containers AVPlayer plays as files. */
const APPLE_FILES = new Set(['mp4', 'm4v', 'mov']);
/** Containers every browser plays. */
const BROWSER_FILES = new Set(['mp4', 'm4v', 'mov', 'webm']);

/** The container of a URL (its path's extension), or undefined. */
export function extOfUrl(url: string): string | undefined {
  const m = /\.([a-z0-9]{2,5})$/i.exec(url.split(/[?#]/)[0]);
  return m ? cleanExt(m[1]) : undefined;
}

function upper(ext: string): string {
  return ext.toUpperCase();
}

/** The message when no form plays here. */
export function vodUnsupportedText(ext: string, platform: StreamPlatform, what: 'film' | 'episode'): string {
  const thing = what === 'film' ? 'This film' : 'This episode';
  if (platform === 'web') return `${thing} is an ${upper(ext)} file, and this browser cannot play it. Try Chrome, the Mac app, or the app on Android or a TV.`;
  if (platform === 'tvos') return `${thing} is an ${upper(ext)} file. Apple TV plays MP4 and HLS only, and the provider offers no other format.`;
  return `${thing} is an ${upper(ext)} file. iPhone and iPad play MP4 and HLS only, and the provider offers no other format. It plays in the app on Android and Android TV, and in the Mac app.`;
}

/** The forms to try for a file of type `ext` at `url`, with `hls` the HLS form of the same path when there is one. */
export function vodChoices(url: string, ext: string, hls: string | null, platform: StreamPlatform, what: 'film' | 'episode'): Omit<LiveStream, 'userAgent'> {
  if (ext === 'm3u8') return { candidates: [{ url, isHls: true }], unsupported: null };
  if (platform === 'android' || platform === 'desktop') return { candidates: [{ url, isHls: false }], unsupported: null };
  const candidates: StreamChoice[] = [];
  if (platform === 'web') {
    if (BROWSER_FILES.has(ext)) return { candidates: [{ url, isHls: false }], unsupported: null };
    // MKV plays in Chromium browsers: the file first, then the HLS form.
    if (ext === 'mkv') candidates.push({ url, isHls: false });
  } else if (APPLE_FILES.has(ext)) {
    return { candidates: [{ url, isHls: false }], unsupported: null };
  }
  if (hls) candidates.push({ url: hls, isHls: true });
  return { candidates, unsupported: vodUnsupportedText(ext, platform, what) };
}

/** The streams to try for an Xtream film. */
export function xtreamFilmStream(film: Pick<Film, 'id' | 'streamId' | 'ext'>, login: XtreamLogin, platform: StreamPlatform, userAgent: string | null): LiveStream {
  const id = film.streamId ?? film.id;
  // A film with no type is most often MP4; the player says when it is not.
  const ext = film.ext ?? 'mp4';
  const r = vodChoices(xtreamFilmUrl(login, id, ext), ext, xtreamFilmUrl(login, id, 'm3u8'), platform, 'film');
  return { ...r, userAgent };
}

/** The streams to try for an Xtream episode. */
export function xtreamEpisodeStream(ep: Pick<Episode, 'id' | 'ext'>, login: XtreamLogin, platform: StreamPlatform, userAgent: string | null): LiveStream {
  const ext = ep.ext ?? 'mp4';
  const r = vodChoices(xtreamEpisodeUrl(login, ep.id, ext), ext, xtreamEpisodeUrl(login, ep.id, 'm3u8'), platform, 'episode');
  return { ...r, userAgent };
}

const PANEL_FILE = /^(https?:\/\/[^/?#]+(?:\/[^/?#]+)*\/(?:movie|series)\/[^/?#]+\/[^/?#]+\/[^/?#.]+)\.[a-z0-9]{2,5}(\?[^#]*)?$/i;

/** The streams to try for an M3U film or episode (its own URL). */
export function m3uVodStream(url: string, platform: StreamPlatform, what: 'film' | 'episode', userAgent: string | null): LiveStream {
  const ext = extOfUrl(url) ?? 'mp4';
  // An entry in the Xtream panel shape has an HLS form too.
  const m = PANEL_FILE.exec(url);
  const hls = m ? `${m[1]}.m3u8${m[2] ?? ''}` : null;
  return { ...vodChoices(url, ext, hls, platform, what), userAgent };
}
