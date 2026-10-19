/**
 * The state of desktop updates (pure; no Tauri, no React). The controller
 * (`./index.ts`) sends events, and the update card reads the state.
 *
 * Phases:
 *   idle ──check──▶ checking ──found──▶ available ──install──▶ downloading ──downloaded──▶ installing
 *                     │  └──none──▶ current (a manual check shows "newest version")
 *                     └──failed──▶ error (step 'check')
 *   downloading ──failed──▶ error (step 'download');  installing ──failed──▶ error (step 'install')
 *
 * Rules:
 * - An automatic check never opens the card for nothing: "up to date" and a
 *   failed check show only after a manual check (the menu or Settings).
 * - A found version opens the card, unless the user chose "Later" for that
 *   version (kept per device). A manual check opens it anyway.
 * - A version that is not newer than the running version is not an update.
 * - During a download or the install, checks and "Later" do nothing.
 * - "Try again" after an error goes back to the step that failed.
 */
import { isNewer } from './version';

export interface UpdateOffer {
  version: string;
  notes: string[];
  /** The publish date (ISO 8601), if latest.json has it. */
  date: string | null;
}

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'installing' }
  | { kind: 'error'; step: 'check' | 'download' | 'install'; message: string };

export interface UpdateState {
  /** The version that runs now. */
  current: string;
  phase: UpdatePhase;
  /** The newer version, once a check found one. */
  offer: UpdateOffer | null;
  /** True when the card shows. */
  open: boolean;
  /** True when the user asked for this check (the card can take the focus). */
  manual: boolean;
  /** The version the user put off with "Later". */
  later: string | null;
  /** The time of the last check that got an answer (ms since 1970). */
  checkedAt: number | null;
}

export type UpdateEvent =
  | { type: 'check'; manual: boolean }
  | { type: 'found'; offer: UpdateOffer; at: number }
  | { type: 'none'; at: number }
  | { type: 'failed'; message: string }
  | { type: 'install' }
  | { type: 'progress'; done: number; total: number }
  | { type: 'downloaded' }
  | { type: 'later' }
  | { type: 'close' }
  | { type: 'reopen' };

export function initialUpdateState(current: string, later: string | null = null): UpdateState {
  return { current, phase: { kind: 'idle' }, offer: null, open: false, manual: false, later, checkedAt: null };
}

/** True while bytes move or the app installs: nothing may stop it. */
export function isBusy(state: UpdateState): boolean {
  return state.phase.kind === 'downloading' || state.phase.kind === 'installing';
}

export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  const busy = isBusy(state);
  switch (event.type) {
    case 'check': {
      if (busy) return event.manual ? { ...state, open: true, manual: true } : state;
      if (state.phase.kind === 'checking') return event.manual ? { ...state, manual: true, open: true } : state;
      // A manual check shows "Checking…" at once; an automatic one stays out of sight.
      return {
        ...state,
        phase: { kind: 'checking' },
        manual: event.manual,
        open: event.manual ? true : state.open && state.offer !== null,
      };
    }
    case 'found': {
      if (busy) return state;
      if (!isNewer(event.offer.version, state.current)) return updateReducer(state, { type: 'none', at: event.at });
      const sameVersion = state.offer?.version === event.offer.version;
      const open = state.manual || state.later !== event.offer.version || (sameVersion && state.open);
      return { ...state, phase: { kind: 'available' }, offer: event.offer, open, checkedAt: event.at };
    }
    case 'none': {
      if (busy) return state;
      return {
        ...state,
        phase: state.manual ? { kind: 'current' } : { kind: 'idle' },
        offer: null,
        open: state.manual,
        checkedAt: event.at,
      };
    }
    case 'failed': {
      const message = event.message.trim() || 'Unknown error.';
      switch (state.phase.kind) {
        case 'checking':
          if (!state.manual) {
            // A failed automatic check is silent; an offer found before stays.
            return { ...state, phase: state.offer ? { kind: 'available' } : { kind: 'idle' } };
          }
          return { ...state, phase: { kind: 'error', step: 'check', message }, open: true };
        case 'downloading':
          return { ...state, phase: { kind: 'error', step: 'download', message }, open: true };
        case 'installing':
          return { ...state, phase: { kind: 'error', step: 'install', message }, open: true };
        default:
          return state;
      }
    }
    case 'install': {
      if (!state.offer || busy) return state;
      return { ...state, phase: { kind: 'downloading', done: 0, total: 0 }, open: true };
    }
    case 'progress': {
      if (state.phase.kind !== 'downloading') return state;
      return { ...state, phase: { kind: 'downloading', done: event.done, total: event.total } };
    }
    case 'downloaded': {
      if (state.phase.kind !== 'downloading') return state;
      return { ...state, phase: { kind: 'installing' } };
    }
    case 'later': {
      if (busy) return state;
      const later = state.offer?.version ?? state.later;
      return { ...state, open: false, later, manual: false, phase: settle(state) };
    }
    case 'close': {
      if (busy) return state;
      return { ...state, open: false, manual: false, phase: settle(state) };
    }
    case 'reopen': {
      if (!state.offer) return state;
      return { ...state, open: true, manual: true };
    }
  }
}

/** After the card closes: an error or "newest version" goes back to a quiet phase. */
function settle(state: UpdateState): UpdatePhase {
  if (state.phase.kind === 'error' || state.phase.kind === 'current') {
    return state.offer ? { kind: 'available' } : { kind: 'idle' };
  }
  return state.phase;
}

/** What "Try again" does after an error: check again, or download and install again. */
export function retryAction(state: UpdateState): 'check' | 'install' | null {
  if (state.phase.kind !== 'error') return null;
  if (state.phase.step === 'check' || !state.offer) return 'check';
  return 'install';
}
