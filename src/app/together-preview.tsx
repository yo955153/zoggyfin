/**
 * Development builds only: the nearby session sheet with fake state, so the
 * screens that need two devices can be seen on the web. Open
 * `/together-preview?s=<state>`. States: host-apple, host-android, guest,
 * guest-android, joining-ble, reconnecting, waiting-host, music, pills.
 * Release builds show nothing.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { TogetherChip, TogetherPill } from '@/features/together/together-pill';
import { type SheetEnv, sheetTitle, TogetherSheetContent } from '@/features/together/together-sheet';
import { font, spacing, type, useTheme } from '@/theme';
import { IDLE } from '@/together/machine';
import { initialTogether, type TogetherState, useTogetherStore } from '@/together/store';

const NOW = Date.now();
const LINK = 'zoggyfin://join?v=1&a=172.20.1.20,10.0.0.4&p=51234&s=3f9a2c1e7b&k=Qm9vVXp4cWtZbFdx&n=Sam%20%C2%B7%20iPhone';

const movie = { id: 'm1', name: 'Sample Movie', type: 'Movie' };

const base: TogetherState = { ...initialTogether, mode: 'nearby', sheet: { open: true, where: 'item', item: null } };

const hostCommon: Partial<TogetherState> = {
  role: 'host',
  phase: { name: 'hosting', sessionId: 's1' },
  item: movie,
  members: [
    { id: 'a', name: 'Jane Doe · iPad', local: true, buffering: false },
    { id: 'b', name: 'Alex · Pixel 8', local: false, buffering: false, away: true },
  ],
  requests: [{ inviteId: 'i1', peerId: 'p1', name: 'Sam · Galaxy S24', have: false, code: true, ble: true }],
  joinCode: { link: LINK, short: 'K7QX-42MP' },
};

const STATES: Record<string, { st: Partial<TogetherState>; env: Partial<SheetEnv> }> = {
  'host-apple': {
    st: {
      ...hostCommon,
      visibleTo: ['Apple devices nearby (direct)', 'Devices on the Wi-Fi “Home Network”', 'Android devices nearby over Bluetooth'],
    },
    env: { platform: 'ios' },
  },
  'host-android': {
    st: {
      ...hostCommon,
      requests: [],
      hotspot: { ssid: 'DIRECT-zf-4821', password: 'p8x2k9qa7w' },
      visibleTo: ['Devices that join the Wi-Fi “DIRECT-zf-4821”', 'Phones and tablets nearby over Bluetooth'],
      rendezvous: { text: 'Sending the Wi-Fi details to Sam…', failed: false },
    },
    env: { platform: 'android', canMakeHotspot: true },
  },
  guest: {
    st: {
      role: 'guest',
      phase: { name: 'browsing' },
      browsingSince: NOW - 10_000,
      localNetwork: 'ok',
      ble: 'unauthorized',
      hosts: [
        { peerId: 'n1', via: 'network', advert: { sessionId: 's1', hostName: 'Sam · iPhone', itemId: 'm1', itemName: 'Sample Movie', serverId: null } },
        { peerId: 'ble:2', via: 'ble', advert: { sessionId: 's2', hostName: 'Jane Doe · Pixel 8', itemId: 'a1', itemName: 'Sample Album', serverId: null, kind: 'audio' } },
      ],
      rejoin: {
        sessionId: 's0',
        key: 'k',
        epoch: 0,
        role: 'guest',
        hostName: 'Sam · iPhone',
        title: 'Sample Movie',
        kind: 'video',
        memberId: 'me',
        itemId: 'm1',
        at: NOW,
      },
    },
    env: { platform: 'ios', network: { type: 'wifi', ssid: 'Hotel Guest' } },
  },
  'guest-android': {
    st: { role: 'guest', phase: { name: 'browsing' }, browsingSince: NOW - 10_000, localNetwork: 'ok', ble: 'on', hosts: [] },
    env: { platform: 'android', canMakeHotspot: true, network: { type: 'none', ssid: null } },
  },
  'joining-ble': {
    st: {
      role: 'guest',
      phase: { name: 'requesting', hostPeerId: 'ble:2', hostName: 'Jane Doe · Pixel 8' },
      rendezvous: { text: 'Joining the Wi-Fi “DIRECT-zf-4821”…', failed: false },
    },
    env: { platform: 'ios' },
  },
  reconnecting: {
    st: {
      role: 'guest',
      kind: 'audio',
      item: { id: 'a1', name: 'Sample Album', type: 'Audio' },
      phase: { name: 'reconnecting', hostName: 'Sam · iPhone', sessionId: 's1', since: NOW, waitingForHost: false },
      hostName: 'Sam · iPhone',
      source: 'stream',
      members: [{ id: 'a', name: 'Jane Doe · iPad', local: false, buffering: false }],
    },
    env: { platform: 'ios' },
  },
  'waiting-host': {
    st: {
      role: 'guest',
      item: movie,
      phase: { name: 'reconnecting', hostName: 'Sam · iPhone', sessionId: 's1', since: NOW, waitingForHost: true },
      hostName: 'Sam · iPhone',
      source: 'stream',
    },
    env: { platform: 'android' },
  },
  music: {
    st: { mode: 'none', phase: IDLE, sheet: { open: true, where: 'music', item: { Id: 'a1', Name: 'Sample Song', Type: 'Audio' } }, hosts: [], browsingSince: NOW },
    env: { platform: 'ios' },
  },
};

export default function TogetherPreview() {
  const { s: which = 'host-apple' } = useLocalSearchParams<{ s?: string }>();
  const { c } = useTheme();
  const preset = STATES[which] ?? STATES['host-apple'];
  const st: TogetherState = { ...base, ...preset.st };
  const env: SheetEnv = { nearbyOn: true, platform: 'ios', canMakeHotspot: false, network: { type: 'wifi', ssid: null }, now: NOW, ...preset.env };

  // The pills read the global store.
  useEffect(() => {
    if (!__DEV__) return;
    useTogetherStore.setState(which === 'pills' ? { ...base, ...STATES['host-apple'].st } : st);
    return () => useTogetherStore.setState(initialTogether);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [which]);

  if (!__DEV__) return null;

  if (which === 'pills') {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: spacing.lg, gap: spacing.lg }}>
        <Text style={{ ...font(type.footnote), color: c.text2 }}>Player pill</Text>
        <View style={{ height: 56, backgroundColor: '#222', borderRadius: 12 }}>
          <TogetherPill top={12} left={12} onPress={() => undefined} />
        </View>
        <Text style={{ ...font(type.footnote), color: c.text2 }}>Mini player chip</Text>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <TogetherChip />
          <TogetherChip iconOnly />
        </View>
      </View>
    );
  }

  const item = st.sheet.item;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Sheet visible title={st.phase.name === 'hosting' || st.phase.name === 'reconnecting' ? (st.item?.name ?? sheetTitle(st, item)) : sheetTitle(st, item)} onClose={() => undefined} doneLabel="Done">
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
          <TogetherSheetContent st={st} item={item} signedIn offline={false} env={env} />
        </ScrollView>
      </Sheet>
    </View>
  );
}
