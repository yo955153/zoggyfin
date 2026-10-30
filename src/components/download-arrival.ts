/**
 * When a download "arrives": the status moves from a running download
 * (downloading or queued) to completed while the view is on screen. Paused or
 * failed to completed does not count: the user did not watch it finish.
 * Pure, so it is unit-tested.
 */
import type { DownloadStatus } from '@/downloads/types';

type State = DownloadStatus['state'];

export function downloadFinished(prev: State, next: State): boolean {
  return (prev === 'downloading' || prev === 'queued') && next === 'completed';
}
