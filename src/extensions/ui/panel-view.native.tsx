/**
 * A panel on iPhone, iPad and Android: a WebView (Expo's DOM WebView, which
 * every build already has). The page talks to the app with
 * `window.ReactNativeWebView.postMessage`; the answers come back as
 * `message` events. Messages from another origin are ignored.
 */
import { type DomWebViewRef, WebView } from '@expo/dom-webview';
import { useRef } from 'react';
import { StyleSheet } from 'react-native';

import { readBridgeMessage, sameOrigin } from '../bridge';
import type { PanelViewProps } from './panel-view-types';

export function PanelView({ url, baseUrl, handle, onError }: PanelViewProps) {
  const ref = useRef<DomWebViewRef>(null);
  return (
    <WebView
      ref={ref}
      source={{ uri: url }}
      style={styles.fill}
      containerStyle={styles.fill}
      allowsInlineMediaPlayback
      onMessage={(e) => {
        const { data, url: from } = e.nativeEvent;
        if (!sameOrigin(from, baseUrl)) return;
        const req = readBridgeMessage(data);
        if (!req) return;
        void handle(req).then((reply) => {
          // JSON is valid JavaScript; the reply is data only.
          ref.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(reply)} }));true;`);
        });
      }}
      onContentProcessDidTerminate={() => onError('The page stopped. Open it again.')}
      onRenderProcessGone={() => onError('The page stopped. Open it again.')}
    />
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: 'transparent' } });
