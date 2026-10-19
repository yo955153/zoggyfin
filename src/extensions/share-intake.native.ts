/**
 * Android: links that other apps share to Zoggyfin (the text/plain intent
 * filter in app.json and the ZoggyfinShare module). iOS has no share
 * extension yet: a Shortcut opens `zoggyfin://share?url=` instead.
 * A build without the module just gets nothing.
 */
import { type EventSubscription, requireOptionalNativeModule } from 'expo';

interface ShareModule {
  takeInitialShare(): string | null;
  addListener(event: 'onShare', fn: (e: { text: string }) => void): EventSubscription;
}

const mod = requireOptionalNativeModule<ShareModule>('ZoggyfinShare');

export function listenForShares(onText: (text: string) => void): () => void {
  if (!mod) return () => {};
  try {
    const first = mod.takeInitialShare();
    if (first) setTimeout(() => onText(first), 0);
  } catch {
    // No start intent.
  }
  const sub = mod.addListener('onShare', (e) => onText(e.text));
  return () => sub.remove();
}
