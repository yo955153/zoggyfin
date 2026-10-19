/**
 * The nearby session state machine. Pure: `transition(phase, event)` returns
 * the next phase, or the same object when the event does not apply.
 *
 *   idle ──HOST──▶ hosting ──END──▶ idle
 *   idle ──BROWSE──▶ browsing ──REQUEST──▶ requesting ──CONNECTED──▶ syncing ──WELCOME──▶ joined
 *                       ▲                      │ DISCONNECTED (declined)               │
 *                       └──────────────────────┘          HOST_ENDED / DISCONNECTED ──▶ ended
 *   any ──LEAVE / RESET──▶ idle;  any ──FAIL──▶ ended
 */

export type EndReason = 'host-ended' | 'lost' | 'error';

export type Phase =
  | { name: 'idle' }
  | { name: 'hosting'; sessionId: string }
  | { name: 'browsing'; notice?: string }
  | { name: 'requesting'; hostPeerId: string; hostName: string }
  | { name: 'syncing'; hostPeerId: string; hostName: string }
  | { name: 'joined'; hostPeerId: string; hostName: string; sessionId: string }
  | { name: 'ended'; reason: EndReason; message: string };

export type PhaseEvent =
  | { type: 'HOST'; sessionId: string }
  | { type: 'BROWSE' }
  | { type: 'REQUEST'; hostPeerId: string; hostName: string }
  | { type: 'CONNECTED'; peerId: string }
  | { type: 'DISCONNECTED'; peerId: string }
  | { type: 'WELCOME'; sessionId: string }
  | { type: 'HOST_ENDED' }
  | { type: 'END' }
  | { type: 'LEAVE' }
  | { type: 'FAIL'; message: string }
  | { type: 'RESET' };

export const IDLE: Phase = { name: 'idle' };

export function transition(phase: Phase, event: PhaseEvent): Phase {
  switch (event.type) {
    case 'HOST':
      return phase.name === 'idle' || phase.name === 'ended' ? { name: 'hosting', sessionId: event.sessionId } : phase;
    case 'BROWSE':
      return phase.name === 'idle' || phase.name === 'ended' || phase.name === 'browsing' ? { name: 'browsing' } : phase;
    case 'REQUEST':
      return phase.name === 'browsing' ? { name: 'requesting', hostPeerId: event.hostPeerId, hostName: event.hostName } : phase;
    case 'CONNECTED':
      return phase.name === 'requesting' && phase.hostPeerId === event.peerId
        ? { name: 'syncing', hostPeerId: phase.hostPeerId, hostName: phase.hostName }
        : phase;
    case 'DISCONNECTED':
      if (phase.name === 'requesting' && phase.hostPeerId === event.peerId) {
        return { name: 'browsing', notice: `${phase.hostName} did not let you join.` };
      }
      if ((phase.name === 'syncing' || phase.name === 'joined') && phase.hostPeerId === event.peerId) {
        return { name: 'ended', reason: 'lost', message: `The connection to ${phase.hostName} was lost.` };
      }
      return phase;
    case 'WELCOME':
      return phase.name === 'syncing'
        ? { name: 'joined', hostPeerId: phase.hostPeerId, hostName: phase.hostName, sessionId: event.sessionId }
        : phase;
    case 'HOST_ENDED':
      return phase.name === 'syncing' || phase.name === 'joined'
        ? { name: 'ended', reason: 'host-ended', message: `${phase.hostName} ended the session.` }
        : phase;
    case 'END':
      return phase.name === 'hosting' ? IDLE : phase;
    case 'LEAVE':
      return phase.name === 'idle' ? phase : IDLE;
    case 'FAIL':
      return { name: 'ended', reason: 'error', message: event.message };
    case 'RESET':
      return phase.name === 'idle' ? phase : IDLE;
  }
}

/** True while this device is in a session (as host or guest). */
export function inSession(phase: Phase): boolean {
  return phase.name === 'hosting' || phase.name === 'syncing' || phase.name === 'joined';
}
