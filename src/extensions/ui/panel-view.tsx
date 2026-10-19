/**
 * A panel on web and in the Mac app: an iframe. The page talks to the app
 * with `window.parent.postMessage`. Only messages from this iframe and from
 * the extension's origin are read; answers go only to that origin.
 */
import { createElement, useEffect, useState } from 'react';

import { readBridgeMessage } from '../bridge';
import type { PanelViewProps } from './panel-view-types';

export function PanelView({ url, baseUrl, handle }: PanelViewProps) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const origin = new URL(baseUrl).origin;
    const onMessage = (e: MessageEvent) => {
      const win = frame?.contentWindow;
      if (!win || e.source !== win || e.origin !== origin) return;
      const req = readBridgeMessage(e.data);
      if (!req) return;
      void handle(req).then((reply) => win.postMessage(reply, origin));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [baseUrl, handle, frame]);
  return createElement('iframe', {
    ref: setFrame,
    src: url,
    title: 'Extension panel',
    // No top navigation and no access to the app's storage: the page runs on its own origin.
    sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads',
    referrerPolicy: 'no-referrer',
    style: { border: 0, width: '100%', height: '100%', flex: 1, background: 'transparent' },
  });
}
