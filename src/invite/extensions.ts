/**
 * The link between invites and the extension system. The extension system
 * gives `extensionsForInvite()` (the manifest URLs of the turned-on
 * extensions) and `installFromInvite(urls)` (one confirm screen for all of
 * them). `wiring.ts` registers them here, so the invite code does not import
 * the extension system. With no registration, invites have no extensions.
 */
import { create } from 'zustand';

export interface InviteExtensionsProvider {
  extensionsForInvite(): string[];
  installFromInvite(urls: string[]): Promise<void>;
}

let provider: InviteExtensionsProvider | null = null;

export function registerInviteExtensions(p: InviteExtensionsProvider | null): void {
  provider = p;
}

export function inviteExtensions(): InviteExtensionsProvider | null {
  return provider;
}

/**
 * The extensions of an invite, to offer after the join. A new account mounts
 * the app again, so the offer waits here and `useInviteLinks` opens it then.
 */
export const useExtensionOffer = create<{ urls: string[] | null }>(() => ({ urls: null }));

export function offerExtensionsLater(urls: string[]): void {
  useExtensionOffer.setState({ urls: urls.length ? urls : null });
}

export function takeExtensionOffer(): string[] | null {
  const { urls } = useExtensionOffer.getState();
  if (urls) useExtensionOffer.setState({ urls: null });
  return urls;
}
