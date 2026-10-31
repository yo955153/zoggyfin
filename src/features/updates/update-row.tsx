/**
 * The update row in Settings. One row for both kinds of update:
 *
 * - A new app (the desktop app, the sideloaded Android TV app):
 *   "Check for Updates…". The value shows the state; a press checks at once,
 *   or opens the card when an update is known. It also checks for an
 *   over-the-air update, quietly. A downloaded one adds "Update ready" above.
 * - An over-the-air update (iPhone, iPad, Android, TV): "Check for updates",
 *   and "Update ready", "Restart" once one is downloaded.
 *
 * A known new app wins: it includes every over-the-air update.
 */
import { SettingsRow } from '@/features/settings/rows';
import { checkForUpdates, reopenUpdateCard, updatesSupported, useUpdateStore, type UpdateState } from '@/platform/updates';
import { offerLabel } from '@/platform/updates/machine';
import { checkForOta, otaActive, reopenOtaCard, useOtaStore } from '@/platform/updates/ota';
import { otaShadowed } from '@/platform/updates/ota-rules';

import { restartForUpdate } from './ota-card';

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

function otaStatusOf(state: UpdateState): string | undefined {
  switch (state.phase.kind) {
    case 'checking':
      return 'Checking…';
    case 'available':
    case 'downloading':
      return 'Downloading…';
    case 'installing':
      return 'Restarting…';
    case 'error':
      return 'Failed';
    default:
      return state.checkedAt ? 'Up to date' : undefined;
  }
}

export function UpdateSettingsRow() {
  const state = useUpdateStore((st) => st.state);
  const ota = useOtaStore((st) => st.state);
  const appOn = updatesSupported;
  const otaOn = otaActive() && !otaShadowed(appOn ? state : null);
  if (!appOn && !otaOn) return null;

  const ready =
    otaOn && ota.phase.kind === 'ready' ? (
      <SettingsRow icon="arrow.clockwise" label="Update ready" value="Restart" onPress={() => void restartForUpdate()} />
    ) : null;

  if (appOn) {
    const onPress = () => {
      if (state.offer && state.phase.kind !== 'error') {
        reopenUpdateCard();
        return;
      }
      void checkForUpdates(true);
      if (otaOn) void checkForOta(false, 'manual');
    };
    return (
      <>
        {ready}
        <SettingsRow icon="arrow.down.circle" label="Check for Updates…" value={statusOf(state)} onPress={onPress} />
      </>
    );
  }
  if (ready) return ready;

  const onPress = () => {
    if (ota.offer && (ota.phase.kind === 'available' || ota.phase.kind === 'downloading')) reopenOtaCard();
    else void checkForOta(true);
  };
  return <SettingsRow icon="arrow.down.circle" label="Check for updates" value={otaStatusOf(ota)} onPress={onPress} />;
}
