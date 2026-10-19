/**
 * The offline entries (design spec, Offline use): the app never needs a
 * sign-in for what works with no server. With no account signed in, or when
 * the server does not answer, the app offers:
 *
 * - "Downloads" when a download is on the device (from any saved or removed
 *   server). Everything there plays from the device.
 * - "Join a nearby session" where the nearby module exists.
 * - Hosting a nearby session: from a download that plays (Downloads, then
 *   the player's Watch together button). It needs a download and the module.
 *
 * Pure, so the gate is unit-tested.
 */

export interface OfflineGateInput {
  /** An account is signed in. */
  signedIn: boolean;
  /** The active server answers: true, false, or null when not known yet. */
  serverReachable: boolean | null;
  /** Completed downloads on the device, from every server. */
  downloads: number;
  /** The native nearby module exists (iPhone, iPad, Mac app; not the web or an old build). */
  nearby: boolean;
}

export interface OfflineEntries {
  downloads: boolean;
  joinNearby: boolean;
  hostNearby: boolean;
}

export const NO_ENTRIES: OfflineEntries = { downloads: false, joinNearby: false, hostNearby: false };

export function offlineEntries(i: OfflineGateInput): OfflineEntries {
  // Signed in and the server answers (or is not checked yet): the normal screens cover these.
  if (i.signedIn && i.serverReachable !== false) return NO_ENTRIES;
  const hasDownloads = i.downloads > 0;
  return { downloads: hasDownloads, joinNearby: i.nearby, hostNearby: i.nearby && hasDownloads };
}

/** Completed downloads in the records (every server). */
export function completedCount(records: Record<string, { state: string }>): number {
  let n = 0;
  for (const r of Object.values(records)) if (r.state === 'completed') n++;
  return n;
}
