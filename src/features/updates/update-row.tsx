/**
 * "Check for Updates…" in Settings (the desktop app and the sideloaded
 * Android TV app). The value shows the
 * update state; a press checks at once, or opens the card when an update
 * is known.
 */
import { SettingsRow } from '@/features/settings/rows';
import { checkForUpdates, reopenUpdateCard, updatesSupported, useUpdateStore, type UpdateState } from '@/platform/updates';
import { offerLabel } from '@/platform/updates/machine';

function statusOf(state: UpdateState): string | undefined {
  switch (state.phase.kind) {
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return 'Downloading…';
    case 'installing':
      return 'Installing…';
    case 'permission':
      return 'Needs permission';
    case 'error':
      return 'Failed';
    default:
      if (state.offer) return `${offerLabel(state.offer)} is available`;
      return state.checkedAt ? 'Up to date' : undefined;
  }
}

export function UpdateSettingsRow() {
  const state = useUpdateStore((st) => st.state);
  if (!updatesSupported) return null;
  const onPress = () => {
    if (state.offer && state.phase.kind !== 'error') reopenUpdateCard();
    else void checkForUpdates(true);
  };
  return <SettingsRow icon="arrow.down.circle" label="Check for Updates…" value={statusOf(state)} onPress={onPress} />;
}
