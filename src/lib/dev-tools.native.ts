/**
 * The development build's floating tools button (expo-dev-menu, the gear)
 * draws over the top trailing corner of the full-screen players. Hide it
 * while a full player is on screen; it comes back when the player closes.
 * Release builds have no such button.
 */
import { useEffect } from 'react';

let hidden = 0;

function setVisible(visible: boolean) {
  if (!__DEV__) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const menu = require('expo-dev-client') as { setToolsButtonVisible?: (v: boolean) => void };
    menu.setToolsButtonVisible?.(visible);
  } catch {
    // Not a development build.
  }
}

export function useHideDevToolsButton(): void {
  useEffect(() => {
    hidden++;
    setVisible(false);
    return () => {
      hidden = Math.max(0, hidden - 1);
      if (hidden === 0) setVisible(true);
    };
  }, []);
}
