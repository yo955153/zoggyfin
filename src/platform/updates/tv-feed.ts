/**
 * The update feed of the sideloaded Android TV app (pure). The release script
 * (`scripts/release-android-tv.sh`) writes `android-tv/latest.json` next to
 * the desktop feed:
 *
 *   {
 *     "versionName": "0.1.0",          the version people see (shown with the build: "0.1.0 (25)")
 *     "versionCode": 25,               the Android build number: the only thing that decides what is newer
 *     "url": "https://…/zoggyfin-tv-0.1.0-25.apk",
 *     "sha256": "<64 hex digits>",     the app checks the file before it installs it
 *     "size": 48123456,                bytes
 *     "notes": "- One line per item",  the CHANGELOG section, as on the desktop
 *     "pub_date": "2026-10-23T10:00:00Z",
 *     "minVersionCode": 10             optional: older builds must update ("Later" does not hide it)
 *   }
 *
 * Every release keeps the version name of app.json, because the OTA runtime
 * version follows it (AGENTS.md section 5). So nothing here compares or keys
 * on `versionName`: newer, "Later" and the cache file name use `versionCode`.
 */
import type { UpdateOffer } from './machine';
import { parseReleaseNotes } from './notes';
import { isVersion } from './version';

/** The feed of public releases. A build can use another one (`EXPO_PUBLIC_TV_UPDATE_URL`). */
export const TV_FEED_URL = 'https://releases.zog-tech.com/zoggyfin/android-tv/latest.json';

export interface TvRelease {
  versionName: string;
  versionCode: number;
  url: string;
  sha256: string;
  size: number;
  notes: string | null;
  date: string | null;
  minVersionCode: number | null;
}

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** The feed URL of this build: the build-time override, or the public feed. */
export function tvFeedUrl(override: string | undefined): string {
  const url = override?.trim();
  return url && /^https:\/\//i.test(url) ? url : TV_FEED_URL;
}

/**
 * Reads `latest.json`. A relative `url` is read against the feed URL. Throws
 * an Error with a short message when the feed is not usable.
 */
export function parseTvFeed(raw: unknown, feedUrl: string): TvRelease {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The update feed is not valid.');
  const o = raw as Record<string, unknown>;
  const versionName = typeof o.versionName === 'string' ? o.versionName.trim() : '';
  if (!isVersion(versionName)) throw new Error('The update feed has no valid version.');
  if (!positiveInt(o.versionCode)) throw new Error('The update feed has no valid build number.');
  if (typeof o.url !== 'string' || !o.url.trim()) throw new Error('The update feed has no download address.');
  let url: string;
  try {
    url = new URL(o.url.trim(), feedUrl).toString();
  } catch {
    throw new Error('The download address is not valid.');
  }
  if (!url.startsWith('https://')) throw new Error('The download address must use HTTPS.');
  const sha256 = typeof o.sha256 === 'string' ? o.sha256.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('The update feed has no valid checksum.');
  if (!positiveInt(o.size)) throw new Error('The update feed has no valid size.');
  const minVersionCode = o.minVersionCode === undefined || o.minVersionCode === null ? null : o.minVersionCode;
  if (minVersionCode !== null && !positiveInt(minVersionCode)) throw new Error('The update feed has a bad minVersionCode.');
  return {
    versionName,
    versionCode: o.versionCode,
    url,
    sha256,
    size: o.size,
    notes: typeof o.notes === 'string' ? o.notes : null,
    date: typeof o.pub_date === 'string' ? o.pub_date : null,
    minVersionCode,
  };
}

/** The offer for the update card. */
export function tvOffer(release: TvRelease, currentBuild: number | null): UpdateOffer {
  return {
    version: release.versionName,
    notes: parseReleaseNotes(release.notes),
    date: release.date,
    build: release.versionCode,
    required: release.minVersionCode !== null && currentBuild !== null && currentBuild < release.minVersionCode,
  };
}

/** The file name in the app cache: one name per build, so a finished download can be used again. */
export function tvApkName(release: Pick<TvRelease, 'versionName' | 'versionCode'>): string {
  return `zoggyfin-tv-${release.versionName.replace(/[^0-9A-Za-z.-]/g, '_')}-${release.versionCode}.apk`;
}
