/**
 * The "Watch together" / "Listen together" session sheet (design spec,
 * Watch together): start or join a nearby session or a SyncPlay group,
 * answer join requests, see the people in the session, who controls, and
 * end or leave. Nearby help: who can find the host, join codes, hotspots
 * and the guest's help card.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { Sheet } from '@/components/sheet';
import { useOffline } from '@/lib/online';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';
import { isAudioItem } from '@/player';
import { audioSession } from '@/player/audio/session';
import { audioState } from '@/player/audio/store';
import { videoSession } from '@/player/session';
import { playerState, usePlayerStore } from '@/player/store';
import { networkSource } from '@/servers/network-source';
import { createStyles, type AppTheme, font, fontFamily, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { wifiQr } from '@/together/join-code';
import { canHostAudio, canHostNearby, nearby, nearbySupported } from '@/together/nearby';
import { guestHelp, HELP_DELAY_MS, helpCopy, type HelpItem, type HelpPlatform, type NetworkInfo } from '@/together/nearby-help';
import { linkNative } from '@/together/nearby-native';
import { closeTogetherSheet, openTogetherSheet, type SheetPlace, type TogetherState, useTogetherStore } from '@/together/store';
import { canSyncPlay, syncPlay, syncPlaySupported } from '@/together/syncplay';
import { groupStateLabel } from '@/together/syncplay-logic';

import { QrCode } from './qr-code';

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);
const AUDIO_ENTRY_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum']);

/** True for the audio items that can start a "Listen together" session: a track, an audiobook, an album or an audio playlist. */
function isAudioEntry(item: BaseItemDto): boolean {
  if (item.Type === 'Playlist') return item.MediaType === 'Audio';
  return AUDIO_ENTRY_TYPES.has(item.Type ?? '');
}

export interface TogetherEntry {
  open: () => void;
  /** "Watch together" or "Listen together". */
  label: string;
}

/** The item page's "Together" action, or null where watch or listen together does not apply. */
export function useTogetherEntry(item: BaseItemDto): TogetherEntry | null {
  const signedIn = useSessionStore((s) => !!s.session);
  const video = VIDEO_TYPES.has(item.Type ?? '');
  if (!features.watchTogether || (!video && !isAudioEntry(item))) return null;
  if (!nearbySupported && !(syncPlaySupported && signedIn)) return null;
  return { open: () => openTogetherSheet('item', item), label: video ? 'Watch together' : 'Listen together' };
}

/** Mount once per screen that can open the sheet; it shows only for its own screen. */
export function TogetherSheetHost({ where }: { where: SheetPlace }) {
  const open = useTogetherStore((s) => s.sheet.open && s.sheet.where === where);
  return open ? <TogetherSheet /> : null;
}

/** What the sheet needs to know about this device. The preview screen gives fake values. */
export interface SheetEnv {
  nearbyOn: boolean;
  platform: HelpPlatform;
  /** This device can make a Wi-Fi network (Android local-only hotspot). */
  canMakeHotspot: boolean;
  network: NetworkInfo | null;
  /** Date.now() of the last render tick, for the help card delay. */
  now: number;
}

function devicePlatform(): HelpPlatform {
  if (Platform.OS === 'android') return 'android';
  return Platform.OS === 'ios' ? 'ios' : 'mac';
}

const isApple = (p: HelpPlatform) => p !== 'android';

/** The device facts for the sheet. Reads the network once and ticks when the help card is due. */
function useSheetEnv(browsingSince: number | null): SheetEnv {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!nearbySupported) return;
    let live = true;
    networkSource
      .snapshot()
      .then((snap) => {
        if (live) setNetwork(snap);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (browsingSince === null) return;
    const due = browsingSince + HELP_DELAY_MS - Date.now();
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, due) + 50);
    return () => clearTimeout(t);
  }, [browsingSince]);
  return {
    nearbyOn: nearbySupported,
    platform: devicePlatform(),
    canMakeHotspot: typeof linkNative?.startHotspot === 'function',
    network,
    now,
  };
}

/** "Listen together" for audio, else "Watch together". */
export function sheetTitle(st: TogetherState, item: BaseItemDto | null): string {
  const inSession = st.mode !== 'none' && st.phase.name !== 'idle' && st.phase.name !== 'browsing';
  const audio = st.sheet.where === 'music' || (!!item && isAudioItem(item)) || (inSession && st.kind === 'audio');
  return audio ? 'Listen together' : 'Watch together';
}

function TogetherSheet() {
  const st = useTogetherStore();
  const playing = usePlayerStore((s) => s.now?.item ?? null);
  // The join place (sign-in screen, offline banner) only joins; hosting starts from a playing download.
  const item: BaseItemDto | null = st.sheet.where === 'join' ? null : (st.sheet.item ?? playing);
  const signedIn = useSessionStore((s) => !!s.session);
  const offline = useOffline();
  const env = useSheetEnv(st.browsingSince);
  const nearbySession = st.mode === 'nearby' && st.phase.name !== 'browsing' && st.phase.name !== 'idle';
  const group = st.syncplay.group;
  const lobby = !nearbySession && !group;

  // In the lobby: look for nearby sessions and SyncPlay groups.
  useEffect(() => {
    if (!lobby) return;
    if (nearbySupported) nearby().browse();
    if (signedIn && !offline && syncPlaySupported) void syncPlay().refreshGroups();
  }, [lobby, signedIn, offline]);

  const close = () => {
    closeTogetherSheet();
    // Stop looking when nothing was joined.
    const s = useTogetherStore.getState();
    if (s.mode === 'nearby' && (s.phase.name === 'browsing' || s.phase.name === 'idle')) void nearby().stopAll();
  };

  const base = sheetTitle(st, item);
  const title = group ? group.name : nearbySession ? (st.item?.name ?? base) : base;
  return (
    <Sheet visible title={title} onClose={close} doneLabel="Done">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
        <TogetherSheetContent st={st} item={item} signedIn={signedIn} offline={offline} env={env} />
      </ScrollView>
    </Sheet>
  );
}

/** The sheet body for a state. Exported for the development preview screen. */
export function TogetherSheetContent({
  st,
  item,
  signedIn,
  offline,
  env,
}: {
  st: TogetherState;
  item: BaseItemDto | null;
  signedIn: boolean;
  offline: boolean;
  env: SheetEnv;
}) {
  const nearbySession = st.mode === 'nearby' && st.phase.name !== 'browsing' && st.phase.name !== 'idle';
  if (st.syncplay.group) return <GroupView st={st} item={item} />;
  if (nearbySession) return <NearbyView st={st} env={env} />;
  return <Lobby st={st} item={item} signedIn={signedIn} offline={offline} env={env} />;
}

// ---- Lobby -------------------------------------------------------------------

/** Starts playback of an audio item (album, playlist, track), then hosts its queue. */
async function playThenHostAudio(item: BaseItemDto): Promise<void> {
  if (audioState().queue.source?.id !== item.Id || playerState().now?.kind !== 'audio') {
    if (playerState().now?.kind === 'video') await videoSession().stop();
    await audioSession().play({ item });
  }
  if (canHostAudio()) await nearby().hostAudio();
  else toast('Play it first, then start the session.');
}

function Lobby({ st, item, signedIn, offline, env }: { st: TogetherState; item: BaseItemDto | null; signedIn: boolean; offline: boolean; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const music = st.sheet.where === 'music';
  const isVideo = !!item && VIDEO_TYPES.has(item.Type ?? '');
  const isAudio = music || (!!item && isAudioItem(item));
  const hostable = canHostNearby(item);
  const [starting, setStarting] = useState(false);
  // The music player shares the queue that plays now; an item page plays its item first.
  const shareQueue = music || !item;

  const startAudio = async () => {
    setStarting(true);
    try {
      if (shareQueue || !item) await nearby().hostAudio();
      else await playThenHostAudio(item);
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      {env.nearbyOn && st.rejoin ? <RejoinCard st={st} /> : null}

      {env.nearbyOn ? (
        <Section
          title="Nearby"
          footer="Works with no internet. Apple devices (iPhone, iPad, Mac app) connect directly. Android needs the same Wi-Fi or a hotspot.">
          {item && isVideo ? (
            hostable ? (
              <Button
                title="Start a nearby session"
                icon="antenna.radiowaves.left.and.right"
                onPress={() => {
                  closeTogetherSheet();
                  void nearby().host(item);
                }}
              />
            ) : (
              <Text style={s.note}>Download this item to share it nearby.</Text>
            )
          ) : null}
          {isAudio && st.sheet.where !== 'join' ? (
            <Button
              title={shareQueue ? 'Start a nearby session' : 'Play and start a nearby session'}
              icon="antenna.radiowaves.left.and.right"
              loading={starting}
              onPress={() => void startAudio()}
            />
          ) : null}
          <Text style={s.label}>Nearby sessions</Text>
          <View style={s.group}>
            {st.hosts.length === 0 ? (
              <View style={s.row}>
                <ActivityIndicator color={c.text3} />
                <Text style={s.rowDetail}>Looking for sessions nearby…</Text>
              </View>
            ) : (
              st.hosts.map((h, i) => {
                const audio = h.advert.kind === 'audio';
                return (
                  <View key={h.peerId} style={[s.row, i < st.hosts.length - 1 && s.rowLine]}>
                    <RowIcon name={audio ? 'music.note' : h.via === 'ble' ? 'dot.radiowaves.left.and.right' : 'antenna.radiowaves.left.and.right'} />
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {h.advert.itemName || (audio ? 'Music' : 'A video')}
                      </Text>
                      <Text style={s.rowDetail} numberOfLines={2}>
                        {h.via === 'ble' ? `${h.advert.hostName} · Needs a quick Wi-Fi link` : h.advert.hostName}
                      </Text>
                    </View>
                    <Button title="Join" variant="small" onPress={() => nearby().join(h.peerId)} />
                  </View>
                );
              })
            )}
          </View>
          {st.notice ? <Text style={s.notice}>{st.notice}</Text> : null}
          <HelpCard st={st} env={env} />
          {st.hotspot && st.role !== 'host' ? <HotspotCard st={st} env={env} guest /> : null}
        </Section>
      ) : null}

      {syncPlaySupported && signedIn ? (
        <Section title="On this server (SyncPlay)" footer="Everyone signs in to this Jellyfin server. Works on the web too.">
          {offline ? (
            <Text style={s.note}>SyncPlay needs the server. You are offline.</Text>
          ) : (
            <>
              <Button
                title={music ? 'Start a group with this queue' : item && canSyncPlay(item) ? 'Start a group with this' : 'Start a group'}
                variant="tonal"
                icon="person.2.fill"
                onPress={() => {
                  closeTogetherSheet();
                  void nearby().stopAll();
                  if (music) void syncPlay().createForAudio();
                  else void syncPlay().create(item && canSyncPlay(item) ? item : null);
                }}
              />
              <Text style={s.label}>Groups</Text>
              <View style={s.group}>
                {st.syncplay.loading && !st.syncplay.groups.length ? (
                  <View style={s.row}>
                    <ActivityIndicator color={c.text3} />
                  </View>
                ) : st.syncplay.groups.length === 0 ? (
                  <View style={s.row}>
                    <Text style={s.rowDetail}>No groups on this server yet.</Text>
                  </View>
                ) : (
                  st.syncplay.groups.map((g, i) => (
                    <View key={g.id} style={[s.row, i < st.syncplay.groups.length - 1 && s.rowLine]}>
                      <RowIcon name="person.2.fill" />
                      <View style={s.rowText}>
                        <Text style={s.rowTitle} numberOfLines={1}>
                          {g.name}
                        </Text>
                        <Text style={s.rowDetail} numberOfLines={1}>
                          {[groupStateLabel(g.state), g.participants.join(', ')].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Button
                        title="Join"
                        variant="small"
                        onPress={() => {
                          closeTogetherSheet();
                          void nearby().stopAll();
                          void syncPlay().join(g.id);
                        }}
                      />
                    </View>
                  ))
                )}
              </View>
              {st.syncplay.error ? <Text style={s.notice}>{st.syncplay.error}</Text> : null}
            </>
          )}
        </Section>
      ) : null}
    </>
  );
}

/** A session from before an app restart: join it again, or forget it. */
function RejoinCard({ st }: { st: TogetherState }) {
  const s = useStyles(makeStyles);
  const r = st.rejoin!;
  const host = r.role === 'host';
  return (
    <View style={s.group}>
      <View style={s.row}>
        <RowIcon name={r.kind === 'audio' ? 'music.note' : 'arrow.clockwise'} />
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={2}>
            {host ? `Resume “${r.title}”` : `Rejoin “${r.title}”`}
          </Text>
          <Text style={s.rowDetail} numberOfLines={2}>
            {host ? 'You hosted this session a moment ago' : `${r.hostName} · you were in this session a moment ago`}
          </Text>
        </View>
      </View>
      <View style={[s.cardButtons]}>
        <Button title="Not now" variant="smallTonal" onPress={() => nearby().dismissRejoin()} />
        <Button title={host ? 'Resume' : 'Rejoin'} variant="small" onPress={() => nearby().rejoin()} />
      </View>
    </View>
  );
}

const HELP_ICONS: Record<HelpItem['id'], IconName> = {
  'local-network-denied': 'wifi.exclamationmark',
  'bluetooth-off': 'dot.radiowaves.left.and.right',
  'bluetooth-denied': 'dot.radiowaves.left.and.right',
  'same-wifi': 'wifi',
  'apple-direct': 'antenna.radiowaves.left.and.right',
  'android-hotspot': 'personalhotspot',
  'personal-hotspot': 'personalhotspot',
  'isolated-wifi': 'exclamationmark.triangle',
  'scan-code': 'qrcode',
  'type-code': 'keyboard',
};

/** The guest's help card: why nothing shows, and what to do. */
function HelpCard({ st, env }: { st: TogetherState; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const [open, setOpen] = useState<'scan-code' | 'type-code' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const help = guestHelp({
    platform: env.platform,
    elapsedMs: st.browsingSince === null ? 0 : env.now - st.browsingSince,
    found: st.hosts.length,
    network: env.network,
    localNetwork: st.localNetwork,
    ble: st.ble,
    canMakeHotspot: env.canMakeHotspot,
    hasMobileData: env.network?.type === 'cellular',
  });
  if (!help.show) return null;

  const run = async (item: HelpItem) => {
    const action = 'action' in item ? item.action : null;
    switch (action) {
      case 'open-settings':
        nearby().openSettings();
        break;
      case 'ask-permission':
        void nearby().allowBluetooth();
        break;
      case 'make-hotspot':
        setBusy(true);
        setError(null);
        try {
          await nearby().makeHotspot();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
        break;
      case 'scan-code':
      case 'type-code':
        setOpen((o) => (o === action ? null : action));
        break;
    }
  };

  return (
    <>
      <Text style={s.label}>{st.localNetwork === 'denied' ? 'Zoggyfin cannot look for sessions' : 'Not finding the session?'}</Text>
      <View style={s.group}>
        {help.items.map((it, i) => {
          const copy = helpCopy(it);
          const action = copy.action;
          const hotspotDone = action?.id === 'make-hotspot' && !!st.hotspot;
          return (
            <View key={it.id} style={[s.helpRow, i < help.items.length - 1 && s.rowLine]}>
              <RowIcon name={HELP_ICONS[it.id]} />
              <View style={[s.rowText, s.helpText]}>
                <Text style={s.rowTitle}>{copy.title}</Text>
                <Text style={s.rowDetail}>{copy.detail}</Text>
                {action && !hotspotDone ? (
                  <View style={s.helpAction}>
                    <Button
                      title={action.label}
                      variant="smallTonal"
                      loading={action.id === 'make-hotspot' && busy}
                      onPress={() => void run(it)}
                    />
                  </View>
                ) : null}
                {action?.id === 'make-hotspot' && error ? <Text style={s.notice}>{error}</Text> : null}
                {action?.id === 'scan-code' && open === 'scan-code' ? (
                  <Text style={s.rowDetail}>Open the Camera app and point it at the host’s code. Zoggyfin opens and asks to join.</Text>
                ) : null}
                {action?.id === 'type-code' && open === 'type-code' ? <CodeInput /> : null}
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

/** The short code field of the help card. */
function CodeInput() {
  const s = useStyles(makeStyles);
  const { c, scheme } = useTheme();
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const submit = () => {
    if (!text.trim()) return;
    const ok = nearby().joinWithCode(text);
    setBad(!ok);
  };
  return (
    <View style={s.codeWrap}>
      <View style={s.codeRow}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setBad(false);
          }}
          onSubmitEditing={submit}
          placeholder="Code"
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          cursorColor={c.accent}
          keyboardAppearance={scheme}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          accessibilityLabel="The host’s code"
          style={s.codeInput}
        />
        <Button title="Join" variant="small" disabled={!text.trim()} onPress={submit} />
      </View>
      {bad ? <Text style={s.notice}>This code is not correct.</Text> : null}
    </View>
  );
}

// ---- Nearby session ------------------------------------------------------------

function NearbyView({ st, env }: { st: TogetherState; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const phase = st.phase;
  const host = st.role === 'host';

  if (phase.name === 'requesting' || phase.name === 'syncing') {
    const ble = phase.name === 'requesting' && phase.hostPeerId.startsWith('ble:');
    return (
      <Section title="Joining">
        <View style={[s.group, s.row]}>
          <ActivityIndicator color={c.text3} />
          <Text style={s.rowDetail}>
            {ble
              ? `Making a Wi-Fi link with ${phase.hostName}…`
              : phase.name === 'requesting'
                ? `Waiting for ${phase.hostName} to let you in…`
                : `Connecting to ${phase.hostName}…`}
          </Text>
        </View>
        <RendezvousRow st={st} />
        <Button title="Cancel" variant="tonal" onPress={() => void nearby().stopAll()} />
      </Section>
    );
  }

  if (phase.name === 'ended') {
    return (
      <Section title="Session ended">
        <Text style={s.note}>{phase.message}</Text>
        <Button title="Done" variant="tonal" onPress={() => void nearby().stopAll()} />
      </Section>
    );
  }

  const reconnecting = phase.name === 'reconnecting' ? phase : null;

  return (
    <>
      {host && st.requests.length ? (
        <Section title="Wants to join">
          <View style={s.group}>
            {st.requests.map((r, i) => (
              <View key={r.inviteId} style={[s.row, i < st.requests.length - 1 && s.rowLine]}>
                <RowIcon name="person.fill" />
                <View style={s.rowText}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={s.rowDetail}>
                    {[r.have ? 'Has it downloaded' : 'Streams it from you', r.code ? 'Has your code' : null, r.ble ? 'Over Bluetooth' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Button title="Decline" variant="smallTonal" onPress={() => nearby().respond(r.inviteId, false)} />
                <Button title="Accept" variant="small" onPress={() => nearby().respond(r.inviteId, true)} />
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {host && st.rendezvous ? <RendezvousRow st={st} /> : null}

      <Section title="People" footer={peopleFooter(st)}>
        <View style={s.group}>
          {reconnecting ? (
            <View style={[s.row, s.rowLine]}>
              <ActivityIndicator color={c.text3} />
              <Text style={s.rowDetail}>
                {reconnecting.waitingForHost
                  ? `${reconnecting.hostName} has the file. Waiting for them to come back…`
                  : `Reconnecting to ${reconnecting.hostName}…`}
              </Text>
            </View>
          ) : null}
          <View style={[s.row, s.rowLine]}>
            <RowIcon name="person.crop.circle" />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{host ? 'You' : (st.hostName ?? reconnecting?.hostName ?? 'Host')}</Text>
              <Text style={s.rowDetail}>Host</Text>
            </View>
          </View>
          {host ? null : (
            <View style={[s.row, st.members.length ? s.rowLine : null]}>
              <RowIcon name="person.fill" />
              <View style={s.rowText}>
                <Text style={s.rowTitle}>You</Text>
                <Text style={s.rowDetail}>{st.source === 'local' ? 'Plays your download' : 'Streams from the host'}</Text>
              </View>
            </View>
          )}
          {st.members.map((m, i, list) => (
            <View key={m.id} style={[s.row, i < list.length - 1 && s.rowLine]}>
              <RowIcon name="person.fill" />
              <View style={s.rowText}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={s.rowDetail}>
                  {m.away ? 'Reconnecting…' : [m.local ? 'Own download' : 'Streams from the host', m.buffering ? 'Loading' : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          ))}
          {host && !st.members.length ? (
            <View style={s.row}>
              <ActivityIndicator color={c.text3} />
              <Text style={s.rowDetail}>Waiting for people nearby to join…</Text>
            </View>
          ) : null}
        </View>
      </Section>

      {host ? <HostHelp st={st} env={env} /> : null}

      <Section title="Controls">
        <View style={[s.group, s.row]}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>Only the host controls</Text>
            <Text style={s.rowDetail}>{st.onlyHostControls ? 'Guests watch; the host plays, pauses and seeks.' : 'Everyone can play, pause, seek and change the speed.'}</Text>
          </View>
          {host ? (
            <Switch value={st.onlyHostControls} onValueChange={(v) => nearby().setOnlyHostControls(v)} trackColor={{ true: c.accent }} />
          ) : (
            <Icon name={st.onlyHostControls ? 'lock.fill' : 'person.2.fill'} size={18} color={c.text2} />
          )}
        </View>
        {st.notice ? <Text style={s.notice}>{st.notice}</Text> : null}
      </Section>

      <Button
        title={host ? 'End session' : 'Leave session'}
        variant="tonal"
        icon="person.2.slash"
        onPress={() => {
          closeTogetherSheet();
          void nearby().stopAll();
        }}
      />
    </>
  );
}

/** The step of a Bluetooth rendezvous (a spinner, or a warning when it failed). */
function RendezvousRow({ st }: { st: TogetherState }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  if (!st.rendezvous) return null;
  return (
    <View style={[s.group, s.row]}>
      {st.rendezvous.failed ? <Icon name="exclamationmark.triangle" size={18} color={c.warning} /> : <ActivityIndicator color={c.text3} />}
      <Text style={[s.rowDetail, st.rendezvous.failed && { color: c.warning }]}>{st.rendezvous.text}</Text>
    </View>
  );
}

function visibleIcon(line: string): IconName {
  if (line.startsWith('No Wi-Fi')) return 'exclamationmark.triangle';
  if (line.includes('Bluetooth')) return 'dot.radiowaves.left.and.right';
  if (line.includes('direct')) return 'antenna.radiowaves.left.and.right';
  return 'wifi';
}

/** The host's help: who can find the session, the join code, and Android help. */
function HostHelp({ st, env }: { st: TogetherState; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const [androidOpen, setAndroidOpen] = useState(false);
  const apple = isApple(env.platform);
  return (
    <>
      {st.visibleTo.length ? (
        <Section title="Visible to">
          <View style={s.group}>
            {st.visibleTo.map((line, i) => (
              <View key={line} style={[s.row, i < st.visibleTo.length - 1 && s.rowLine]}>
                <RowIcon name={visibleIcon(line)} />
                <Text style={[s.rowDetail, s.rowText, line.startsWith('No Wi-Fi') && { color: c.warning }]}>{line}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {apple ? null : <HotspotCard st={st} env={env} />}

      {st.joinCode ? (
        <Section
          title="Join with a code"
          footer="Scan with the Camera app on the other device, or type the code. Use it when the Wi-Fi does not let devices see each other (common in hotels and on planes). You still accept each person.">
          <View style={[s.group, s.codeCard]}>
            <QrCode value={st.joinCode.link} size={180} label="The session code. Scan it on the other device." />
            <Text style={s.shortCode} selectable accessibilityLabel={`Code: ${st.joinCode.short.split('').join(' ')}`}>
              {st.joinCode.short}
            </Text>
          </View>
        </Section>
      ) : null}

      {apple ? (
        <View style={s.group}>
          <Pressable
            onPress={() => setAndroidOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: androidOpen }}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: c.surface2 }]}>
            <RowIcon name="info.circle" />
            <Text style={[s.rowTitle, s.rowText]}>Someone on Android?</Text>
            <Icon name={androidOpen ? 'chevron.up' : 'chevron.down'} size={14} color={c.text3} weight="semibold" />
          </Pressable>
          {androidOpen ? (
            <View style={s.expand}>
              <Text style={s.rowDetail}>
                Put both devices on the same Wi-Fi. With no Wi-Fi, the Android device makes the network: on that device, tap Make a hotspot in this sheet. If your
                iPhone has mobile data, Personal Hotspot also works.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const SETTINGS_ERROR = /permission|location|settings|allow/i;

/** Android: make a Wi-Fi network for the session and show its QR code. */
function HotspotCard({ st, env, guest = false }: { st: TogetherState; env: SheetEnv; guest?: boolean }) {
  const s = useStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  const title = st.kind === 'audio' || st.sheet.where === 'music' ? 'Listen together' : 'Watch together';

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const h = await nearby().makeHotspot();
      if (!h) setNone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (st.hotspot) {
    return (
      <Section
        title="Hotspot"
        footer={
          guest
            ? `Join this Wi-Fi on the other device, then open ${title} there.`
            : `1. Scan this on the other device to join the Wi-Fi. 2. Then scan the session code or open ${title}.`
        }>
        <View style={[s.group, s.codeCard]}>
          <QrCode value={wifiQr(st.hotspot.ssid, st.hotspot.password)} size={180} label="The Wi-Fi code. Scan it on the other device to join the Wi-Fi." />
          <View style={s.wifiFacts}>
            <Text style={s.wifiLabel}>Wi-Fi</Text>
            <Text style={s.wifiValue} selectable>
              {st.hotspot.ssid}
            </Text>
            <Text style={s.wifiLabel}>Password</Text>
            <Text style={s.wifiValue} selectable>
              {st.hotspot.password}
            </Text>
          </View>
        </View>
        <Button title="Stop the hotspot" variant="tonal" icon="xmark" onPress={() => nearby().stopHotspot()} />
      </Section>
    );
  }

  if (guest) return null;

  if (!env.canMakeHotspot || none) {
    return (
      <Section title="No Wi-Fi?">
        <Text style={s.note}>Turn on the hotspot of this phone: Settings &gt; Connections &gt; Mobile Hotspot. Then the other device joins it.</Text>
      </Section>
    );
  }

  return (
    <Section title="No Wi-Fi?" footer="This phone makes a Wi-Fi network for the session. It needs no mobile data.">
      <Button title="Create a hotspot for this session" variant="tonal" icon="personalhotspot" loading={busy} onPress={() => void make()} />
      {error ? <Text style={s.notice}>{error}</Text> : null}
      {error && SETTINGS_ERROR.test(error) ? <Button title="Open Settings" variant="smallTonal" icon="gearshape" onPress={() => nearby().openSettings()} /> : null}
    </Section>
  );
}

function peopleFooter(st: TogetherState): string | undefined {
  const parts: string[] = [];
  if (st.waiting) parts.push('Waiting while someone loads.');
  if (st.sync && st.role === 'guest') {
    const d = st.sync.drift;
    parts.push(d === null ? 'Syncing…' : Math.abs(d) < 150 ? `In sync (${Math.round(Math.abs(d))} ms)` : `Catching up (${Math.round(d)} ms)`);
  }
  return parts.join(' ') || undefined;
}

// ---- SyncPlay group --------------------------------------------------------------

function GroupView({ st, item }: { st: TogetherState; item: BaseItemDto | null }) {
  const s = useStyles(makeStyles);
  const group = st.syncplay.group!;
  const playingId = usePlayerStore((x) => x.now?.item.Id ?? null);
  return (
    <>
      <Section title="SyncPlay" footer={st.sync ? `Server clock: ${Math.round(st.sync.rtt)} ms round trip.` : undefined}>
        <View style={s.group}>
          <View style={[s.row, s.rowLine]}>
            <RowIcon name="person.2.fill" />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{groupStateLabel(group.state)}</Text>
              <Text style={s.rowDetail} numberOfLines={2}>
                {group.participants.join(', ') || 'Only you'}
              </Text>
            </View>
          </View>
          <View style={s.row}>
            <Text style={s.rowDetail}>Everyone in the group can play, pause and seek.</Text>
          </View>
        </View>
      </Section>
      {item && canSyncPlay(item) && item.Id !== playingId ? (
        <Button title={`Play “${item.Name ?? 'this'}” for the group`} icon="play.fill" onPress={() => void syncPlay().playInGroup(item)} />
      ) : null}
      {item && canSyncPlay(item) && item.Id === playingId && group.state === 'Idle' ? (
        <Button title="Play this for the group" icon="play.fill" onPress={() => void syncPlay().playInGroup(item)} />
      ) : null}
      <View style={s.buttonRow}>
        <Button title="Previous" variant="tonal" icon="backward.fill" onPress={() => void syncPlay().previous()} containerStyle={{ flex: 1 }} />
        <Button title="Next" variant="tonal" icon="forward.fill" onPress={() => void syncPlay().next()} containerStyle={{ flex: 1 }} />
      </View>
      <Button
        title="Leave group"
        variant="tonal"
        icon="person.2.slash"
        onPress={() => {
          closeTogetherSheet();
          void syncPlay().leave();
        }}
      />
    </>
  );
}

// ---- Parts -----------------------------------------------------------------------

function Section({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.section}>
      <Text style={s.header} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}

function RowIcon({ name }: { name: IconName }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={s.rowIcon}>
      <Icon name={name} size={16} color={c.text} />
    </View>
  );
}

const monoFamily = Platform.select({ ios: 'Menlo', android: 'monospace', default: fontFamily.webMono });

const makeStyles = createStyles(({ c }: AppTheme) => ({
  section: { gap: spacing.sm },
  header: { ...font(type.footnote), color: c.text2, letterSpacing: 0.4, paddingHorizontal: spacing.xs },
  footer: { ...font(type.footnote), color: c.text2, paddingHorizontal: spacing.xs },
  label: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text, paddingHorizontal: spacing.xs, marginTop: spacing.xs },
  note: { ...font(type.subheadline), color: c.text2, paddingHorizontal: spacing.xs },
  notice: { ...font(type.footnote), color: c.warning, paddingHorizontal: spacing.xs },
  group: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.settingsRow + 6),
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...font(type.body), color: c.text },
  rowDetail: { ...font(type.footnote), color: c.text2, flexShrink: 1 },
  rowIcon: { width: 29, height: 29, borderRadius: 7, backgroundColor: c.surface3, alignItems: 'center' as const, justifyContent: 'center' as const },
  buttonRow: { flexDirection: 'row' as const, gap: spacing.md },
  cardButtons: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  helpRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  helpText: { gap: spacing.xs },
  helpAction: { flexDirection: 'row' as const, marginTop: spacing.xs },
  codeWrap: { gap: spacing.xs, marginTop: spacing.xs },
  codeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  codeInput: {
    ...font(type.body),
    fontFamily: monoFamily,
    letterSpacing: 2,
    flex: 1,
    minWidth: 0,
    color: c.text,
    backgroundColor: c.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: scaled(40),
    borderWidth: 1,
    borderColor: c.controlBorder,
    borderCurve: 'continuous' as const,
  },
  codeCard: { alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
  shortCode: { ...font(type.title2), fontFamily: monoFamily, fontWeight: '600' as const, letterSpacing: 3, color: c.text, textAlign: 'center' as const },
  wifiFacts: { alignSelf: 'stretch' as const, gap: 2 },
  wifiLabel: { ...font(type.footnote), color: c.text2 },
  wifiValue: { ...font(type.body), fontFamily: monoFamily, color: c.text, marginBottom: spacing.xs },
  expand: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingLeft: spacing.lg + 29 + spacing.md },
}));
