/**
 * Development builds only: drives watch together from a link, so two
 * simulators can run the spike measurements without taps, for example
 * `xcrun simctl openurl <device> "zoggyfin://together-lab?do=host&item=<id>"`.
 * Actions: host, browse, join, accept, play, pause, seek (to=seconds),
 * rate (to=rate), only (to=1|0), stop, stats. Release builds show nothing.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { downloadedItem } from '@/downloads';
import { videoSession } from '@/player/session';
import { nearby } from '@/together/nearby';
import { togetherState, useTogetherStore } from '@/together/store';

async function run(action: string, params: Record<string, string | undefined>): Promise<string> {
  const n = nearby();
  switch (action) {
    case 'host': {
      const item = params.item ? downloadedItem(params.item) : null;
      if (!item) return 'no such download';
      await n.host(item);
      return 'hosting';
    }
    case 'browse':
      n.browse();
      return 'browsing';
    case 'join': {
      for (let i = 0; i < 40 && !togetherState().hosts.length; i++) await new Promise((r) => setTimeout(r, 250));
      n.devForceStream = params.stream === '1';
      const h = togetherState().hosts[0];
      if (!h) return 'no host found';
      n.join(h.peerId);
      return `asked ${h.advert.hostName}`;
    }
    case 'accept':
      for (let i = 0; i < 40 && !togetherState().requests.length; i++) await new Promise((r) => setTimeout(r, 250));
      for (const r of togetherState().requests) n.respond(r.inviteId, true);
      return 'accepted';
    case 'play':
      videoSession().play_();
      return 'play';
    case 'pause':
      videoSession().pause();
      return 'pause';
    case 'seek':
      videoSession().seekTo(Number(params.to ?? 0));
      return 'seek';
    case 'rate':
      videoSession().setRate(Number(params.to ?? 1));
      return 'rate';
    case 'only':
      n.setOnlyHostControls(params.to === '1');
      return 'policy';
    case 'stop':
      await n.stopAll();
      return 'stopped';
    case 'stats': {
      const s = togetherState();
      const out = JSON.stringify({ phase: s.phase, sync: s.sync, members: s.members, source: s.source, media: n.mediaStats() });
      try {
        new File(Paths.document, 'together-stats.json').write(out);
      } catch {
        // Ignore.
      }
      return out;
    }
    default:
      return 'unknown action';
  }
}

export default function TogetherLab() {
  const params = useLocalSearchParams<Record<string, string>>();
  const [result, setResult] = useState('…');
  const phase = useTogetherStore((s) => s.phase.name);
  useEffect(() => {
    if (!__DEV__ || Platform.OS === 'web') return;
    void run(params.do ?? '', params).then((r) => {
      setResult(r);
      console.log('[together-lab]', params.do, r);
      if (params.do !== 'stats' && params.do !== 'host' && params.do !== 'join') setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), 300);
    });
    // Run once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.do, params.item, params.to]);
  if (!__DEV__) return null;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
      <Text style={{ color: '#fff' }}>{`${params.do ?? ''}: ${result} (${phase})`}</Text>
    </View>
  );
}
