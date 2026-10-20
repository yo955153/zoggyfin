/**
 * Development builds only: drives watch together from a link, so two
 * simulators can run the spike measurements without taps, for example
 * `xcrun simctl openurl <device> "zoggyfin://together-lab?do=host&item=<id>"`.
 * Actions: host, browse, join (stream=1 to stream even with a
 * local copy), accept, play, pause, seek (to=seconds), rate (to=rate), only
 * (to=1|0), stop, stats, spjoin (group=SyncPlay group Id), spleave.
 * Audio: hostaudio (item=a downloaded album, playlist or track), aplay, apause,
 * aseek (to=seconds), next, previous, arate (to=rate). code (text=a join link
 * or short code), spaudio (create a SyncPlay group with the audio queue),
 * rejoin (the saved session after an app restart), aqueue (like hostaudio,
 * with no nearby session), spfirst (join a SyncPlay group: group=id, else the last one), spgroups.
 * Rooms: room (open an empty room), playitem (item=id: the normal Play button, so in a room it plays
 * for everyone; a guest asks the host).
 * The desktop development build runs it too (see `__togetherLab`).
 * Release builds show nothing.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { downloadedChildren, downloadedItem } from '@/downloads';
import { downloadsState } from '@/downloads/store';
import { isDesktop } from '@/platform/desktop';
import { getApi } from '@/api/client';
import { getItem } from '@/api/jellyfin';
import { useSessionStore } from '@/auth/session-store';
import { playHere, playRouter } from '@/player';
import { audioSession } from '@/player/audio/session';
import { videoSession } from '@/player/session';
import { nearby } from '@/together/nearby';
import { syncPlay } from '@/together/syncplay';
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
    case 'hostaudio':
    case 'aqueue': {
      const id = params.item ?? '';
      const item = downloadedItem(id);
      // A container id, or a track (with its album's downloaded tracks).
      const album = item?.AlbumId
        ? Object.values(downloadsState().records)
            .filter((r) => r.state === 'completed' && r.item.AlbumId === item.AlbumId)
            .map((r) => r.item)
            .sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0))
        : [];
      const list = downloadedChildren(id) ?? (album.length ? album : item ? [item] : []);
      if (!list.length) return 'no such download';
      const at = Math.max(0, list.findIndex((i) => i.Id === id));
      await audioSession().playList(list, params.index ? Number(params.index) : at, { shuffle: false, source: { name: item?.Name ?? 'Album', id, type: item?.Type ?? 'MusicAlbum' }, longForm: false });
      audioSession().pause();
      if (action === 'aqueue') return 'queue loaded';
      await new Promise((r) => setTimeout(r, 1500));
      await n.hostAudio();
      return 'hosting audio';
    }
    case 'aplay':
      audioSession().resume();
      return 'play';
    case 'apause':
      audioSession().pause();
      return 'pause';
    case 'aseek':
      audioSession().seekTo(Number(params.to ?? 0));
      return 'seek';
    case 'arate':
      audioSession().setRate(Number(params.to ?? 1));
      return 'rate';
    case 'next':
      audioSession().next();
      return 'next';
    case 'previous':
      audioSession().previous();
      return 'previous';
    case 'code':
      return n.joinWithCode(params.text ?? '') ? 'joining by code' : 'bad code';
    case 'room':
      return (await n.openRoom()) ? 'room open' : 'no room';
    case 'playitem': {
      const id = params.item ?? '';
      const s = useSessionStore.getState().session;
      const item = downloadedItem(id) ?? (s ? await getItem(getApi(s.serverUrl, s.token), s.userId, id) : null);
      if (!item) return 'no such item';
      // The same path as a Play button (usePlayer().play).
      const routed = playRouter.route({ item }, 'user');
      if (routed) playHere(routed);
      return `play ${item.Name ?? id}`;
    }
    case 'spaudio':
      await syncPlay().createForAudio();
      return 'group with the queue';
    case 'rejoin':
      n.loadSaved();
      if (!togetherState().rejoin) return 'nothing to rejoin';
      n.rejoin();
      return 'rejoining';
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
    case 'spjoin':
      if (!params.group) return 'no group';
      await syncPlay().join(params.group);
      return 'joined group';
    case 'spgroups':
      await syncPlay().refreshGroups();
      return JSON.stringify(togetherState().syncplay.groups);
    case 'spfirst': {
      await syncPlay().refreshGroups();
      const gs = togetherState().syncplay.groups;
      const g = params.group ? gs.find((x) => x.id === params.group) : gs[gs.length - 1];
      if (!g) return 'no group';
      await syncPlay().join(g.id);
      return `joined ${g.name}`;
    }
    case 'spleave':
      await syncPlay().leave();
      return 'left group';
    case 'stop':
      await n.stopAll();
      return 'stopped';
    case 'stats': {
      const s = togetherState();
      const out = JSON.stringify({ phase: s.phase, sync: s.sync, members: s.members, source: s.source, media: n.mediaStats(), joinCode: s.joinCode, visibleTo: s.visibleTo, kind: s.kind, hosts: s.hosts.length });
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

// The desktop automation script calls the actions with
// `__togetherLab(action, params)`, so the page does not reload between them.
if (__DEV__ && isDesktop) (globalThis as { __togetherLab?: typeof run }).__togetherLab = run;

export default function TogetherLab() {
  const params = useLocalSearchParams<Record<string, string>>();
  const [result, setResult] = useState('…');
  const phase = useTogetherStore((s) => s.phase.name);
  useEffect(() => {
    if (!__DEV__ || (Platform.OS === 'web' && !isDesktop)) return;
    void run(params.do ?? '', params).then((r) => {
      setResult(r);
      console.log('[together-lab]', params.do, r);
      if (!['stats', 'host', 'join', 'spjoin', 'hostaudio', 'code', 'spaudio', 'aqueue', 'spfirst'].includes(params.do ?? '')) setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), 300);
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
