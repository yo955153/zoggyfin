/**
 * Desktop updates: the controller between the update card and Rust
 * (`desktop/src-tauri/src/update.rs`). The state rules are in `./machine.ts`.
 *
 * - Release builds check 10 s after start and every 4 hours. "Check for
 *   Updates…" (the app menu and Settings) checks at once.
 * - "Install and restart" downloads the signed update with progress, checks
 *   the signature, puts it in place of the installed app, quits, and starts
 *   the same app again.
 * - In a browser and on iPhone and iPad nothing here runs (`updatesSupported`).
 */
import { create } from 'zustand';

import { appVersion, autoUpdate, invoke, isDesktop, onMenuCommand, onUpdateEvent } from '../desktop';

import { initialUpdateState, retryAction, type UpdateEvent, updateReducer, type UpdateState } from './machine';
import { parseReleaseNotes } from './notes';

export { compareVersions, isNewer } from './version';
export type { UpdateOffer, UpdatePhase, UpdateState } from './machine';

export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** True in the desktop app on macOS, where updates work. */
export const updatesSupported: boolean = isDesktop && appVersion !== null;

const LATER_KEY = 'zf:update-later';

function readLater(): string | null {
  try {
    return globalThis.localStorage?.getItem(LATER_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLater(version: string | null): void {
  try {
    if (version) globalThis.localStorage?.setItem(LATER_KEY, version);
  } catch {
    // Blocked storage: "Later" lasts for this run only.
  }
}

interface Store {
  state: UpdateState;
  send: (event: UpdateEvent) => void;
}

export const useUpdateStore = create<Store>((set, get) => ({
  state: initialUpdateState(appVersion ?? '0.0.0', readLater()),
  send: (event) => {
    const before = get().state;
    const after = updateReducer(before, event);
    if (after === before) return;
    if (after.later !== before.later) writeLater(after.later);
    set({ state: after });
  },
}));

const send = (event: UpdateEvent) => useUpdateStore.getState().send(event);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface CheckResult {
  version: string;
  current: string;
  notes: string | null;
  date: string | null;
}

let checking: Promise<void> | null = null;

/** Looks for a newer version. `manual`: the user asked (the card shows the answer). */
export function checkForUpdates(manual = false): Promise<void> {
  if (!updatesSupported) return Promise.resolve();
  send({ type: 'check', manual });
  checking ??= (async () => {
    try {
      const found = await invoke<CheckResult | null>('update_check');
      const at = Date.now();
      if (found && typeof found.version === 'string') {
        send({
          type: 'found',
          offer: { version: found.version, notes: parseReleaseNotes(found.notes), date: found.date ?? null },
          at,
        });
      } else {
        send({ type: 'none', at });
      }
    } catch (err) {
      send({ type: 'failed', message: message(err) });
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** "Install and restart": download with progress, install, quit and start again. */
export async function installUpdate(): Promise<void> {
  const before = useUpdateStore.getState().state;
  send({ type: 'install' });
  if (useUpdateStore.getState().state === before) return;
  try {
    await invoke('update_download');
    send({ type: 'downloaded' });
    // On success the app quits in this call.
    await invoke('update_install_and_relaunch');
  } catch (err) {
    send({ type: 'failed', message: message(err) });
  }
}

/** "Try again" on an error: the step that failed. */
export function retryUpdate(): void {
  const action = retryAction(useUpdateStore.getState().state);
  if (action === 'check') void checkForUpdates(true);
  else if (action === 'install') void installUpdate();
}

export const laterUpdate = () => send({ type: 'later' });
export const closeUpdateCard = () => send({ type: 'close' });
export const reopenUpdateCard = () => send({ type: 'reopen' });

let started = false;

/** Starts the checks (once). The root layout calls it; it does nothing outside the desktop app. */
export function startUpdateChecks(): void {
  if (!updatesSupported || started) return;
  started = true;
  onUpdateEvent((e) => {
    if (e.type === 'progress') send({ type: 'progress', done: e.done, total: e.total });
  });
  onMenuCommand((command) => {
    if (command === 'check-updates') void checkForUpdates(true);
  });
  if (!autoUpdate) return;
  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
}
