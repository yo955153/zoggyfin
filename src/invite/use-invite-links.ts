/**
 * Invite links in the desktop app. macOS gives a `zoggyfin://join#…` link to
 * the Rust side (the deep-link plugin). Rust keeps it and calls
 * `window.__zoggyfinLink()`; this hook takes the links and opens the invite
 * screen. iOS and Android use `app/+native-intent.tsx` instead. It also
 * opens the extension offer of an invite after the join.
 */
import { type Href, router } from 'expo-router';
import { useEffect } from 'react';

import { useSession } from '@/auth/session-store';
import { invoke, isDesktop } from '@/platform/desktop';

import { inviteExtensions, takeExtensionOffer } from './extensions';
import { setIncomingInvite } from './incoming';
import { payloadFromText } from './payload';

type LinkWindow = Window & { __zoggyfinLink?: () => void };

async function takeLinks(): Promise<void> {
  let urls: string[] = [];
  try {
    urls = await invoke<string[]>('desktop_take_links');
  } catch {
    return; // An older desktop build without the command.
  }
  for (const url of urls) {
    const payload = payloadFromText(url);
    if (!payload) continue;
    setIncomingInvite(payload);
    router.push('/accept-invite' as Href);
  }
}

export function useInviteLinks(): void {
  const signedIn = !!useSession();
  // After a join: offer the inviter's extensions on the extension system's confirm screen.
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => {
      const p = inviteExtensions();
      const urls = p ? takeExtensionOffer() : null;
      if (p && urls) void p.installFromInvite(urls).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [signedIn]);

  useEffect(() => {
    if (!isDesktop || typeof window === 'undefined') return;
    const w = window as LinkWindow;
    w.__zoggyfinLink = () => void takeLinks();
    void takeLinks();
    return () => {
      delete w.__zoggyfinLink;
    };
  }, []);
}
