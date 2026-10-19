/**
 * Discovery on the server address screen. It runs only while the screen has
 * the focus, and stops at once when the user leaves it. It never runs in the
 * background.
 *
 * iOS and the Mac app ask the user for local network access. The screen first
 * shows a short card that tells why; its Continue button shows the system
 * prompt on purpose, so that the prompt does not come later, in the middle of
 * a sign-in. The card shows only once.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSessionStore } from '@/auth/session-store';
import { discoveryBackend } from '@/servers/discovery/backend';
import { runDiscovery } from '@/servers/discovery/discover';
import { lanHelpFor, type LanAccess, type LanHelp } from '@/servers/discovery/lan-access';
import type { DiscoveredServer } from '@/servers/discovery/types';
import { storage } from '@/storage/kv';

/** 'asked': the user saw the card and the system prompt; 'skipped': the user chose "Not now". */
const PRIMER_KEY = 'discovery.lanPrimer';
/** How long the app waits for the user to answer the system prompt. */
const PROMPT_WAIT_MS = 60_000;
/** A later check of access is quick when access is on. */
const CHECK_WAIT_MS = 3000;
/** The check after a failed request: short, the user waits for the message. */
const LAN_CHECK_AFTER_FAILURE_MS = 1500;

export type DiscoveryPhase =
  /** The web: no discovery. */
  | 'off'
  /** The card that explains local network access (first time only). */
  | 'primer'
  /** The system prompt is open. */
  | 'prompt'
  /** The user chose "Not now": discovery starts only on a tap. */
  | 'paused'
  | 'searching'
  | 'done';

export interface ServerDiscovery {
  phase: DiscoveryPhase;
  servers: DiscoveredServer[];
  lan: LanAccess;
  /** Shows the system prompt (iOS, Mac), then searches. */
  allow(): void;
  /** Hides the card; the user types an internet address. */
  skip(): void;
  refresh(): void;
  openSettings(): void;
}

function initialPhase(): DiscoveryPhase {
  if (!discoveryBackend.available) return 'off';
  if (!discoveryBackend.asksLanAccess) return 'searching';
  const v = storage.getString(PRIMER_KEY);
  return v === 'asked' ? 'searching' : v === 'skipped' ? 'paused' : 'primer';
}

export function useServerDiscovery(): ServerDiscovery {
  const [phase, setPhase] = useState<DiscoveryPhase>(initialPhase);
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [lan, setLan] = useState<LanAccess>('unknown');
  const run = useRef<AbortController | null>(null);
  const focused = useRef(false);

  const stop = useCallback(() => {
    run.current?.abort();
    run.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    if (!discoveryBackend.available || !focused.current) return;
    const ctl = new AbortController();
    run.current = ctl;
    setPhase('searching');
    setServers([]);
    const discovery = runDiscovery(discoveryBackend, { signal: ctl.signal, onServers: setServers });
    // iOS: a quick check finds out if the user turned access off in Settings.
    const check = discoveryBackend.asksLanAccess ? discoveryBackend.lanAccess(CHECK_WAIT_MS) : Promise.resolve<LanAccess>('unknown');
    void Promise.all([discovery, check]).then(([r, checked]) => {
      if (ctl.signal.aborted) return;
      run.current = null;
      // A saved server found at a new address keeps that address (the server Id is the same).
      useSessionStore.getState().learnAddresses(r.servers.map((x) => ({ serverId: x.id, url: x.address })));
      setLan(r.lan === 'granted' || checked === 'granted' ? 'granted' : checked === 'denied' || r.lan === 'denied' ? 'denied' : 'unknown');
      setPhase('done');
    });
  }, [stop]);

  const allow = useCallback(() => {
    stop();
    storage.set(PRIMER_KEY, 'asked');
    setPhase('prompt');
    const ctl = new AbortController();
    run.current = ctl;
    void discoveryBackend.lanAccess(PROMPT_WAIT_MS).then((access) => {
      if (ctl.signal.aborted) return;
      run.current = null;
      setLan(access);
      if (access === 'denied') setPhase('done');
      else start();
    });
  }, [start, stop]);

  const skip = useCallback(() => {
    storage.set(PRIMER_KEY, 'skipped');
    setPhase('paused');
  }, []);

  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      // Start (or start again) when the screen gets the focus; no prompt without a tap.
      const p = phaseRef.current;
      if (p === 'searching' || p === 'done') start();
      return () => {
        focused.current = false;
        stop();
        // A run that stopped half way is not a result.
        setPhase((x) => (x === 'searching' || x === 'prompt' ? 'done' : x));
      };
    }, [start, stop]),
  );

  return {
    phase,
    servers,
    lan,
    allow,
    skip,
    refresh: () => (phase === 'paused' || phase === 'primer' ? allow() : start()),
    openSettings: () => void discoveryBackend.openSettings().catch(() => undefined),
  };
}

/** True when the platform asks for local network access (iOS, the Mac app). */
export const asksLanAccess = discoveryBackend.asksLanAccess;
export const openLanSettings = (): void => void discoveryBackend.openSettings().catch(() => undefined);

/** The help for a failed request to `url` (local network access, VPN or Tailscale), or null. */
export async function lanHelpAfterFailure(url: string, e: unknown): Promise<LanHelp | null> {
  if (!lanHelpFor(url, e, true, true)) return null;
  const vpn = await discoveryBackend.vpnActive().catch(() => false);
  const help = lanHelpFor(url, e, discoveryBackend.asksLanAccess, vpn);
  if (help !== 'lan-access' && help !== 'lan-access-vpn') return help;
  // Access is on (a quick check): the server is off or the address is wrong.
  const access = await discoveryBackend.lanAccess(LAN_CHECK_AFTER_FAILURE_MS).catch(() => 'unknown' as const);
  if (access !== 'granted') return help;
  return help === 'lan-access-vpn' ? 'vpn' : null;
}
