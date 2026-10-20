/**
 * "Start a session" in the together sheet: pick what to play (when the
 * sheet has no item yet), then one choice, "Who can join?". The transport
 * (nearby or the Jellyfin server) follows from that choice; the user never
 * picks "SyncPlay" or "LAN".
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { getApi } from '@/api/client';
import * as jf from '@/api/jellyfin';
import type { BaseItemDto } from '@/api/types';
import { useSession, useSessionStore } from '@/auth/session-store';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { findDownload } from '@/downloads';
import { searchDownloads } from '@/downloads/lists';
import { useDownloadsStore } from '@/downloads/store';
import { useDebounced } from '@/lib/use-debounced';
import { toast } from '@/lib/toast';
import { isAudioItem } from '@/player';
import { audioSession } from '@/player/audio/session';
import { audioState } from '@/player/audio/store';
import { videoSession } from '@/player/session';
import { playerState, usePlayerStore } from '@/player/store';
import { useStyles, useTheme } from '@/theme';
import { whoCanJoin, type Transport } from '@/together/hub';
import { defaultFindable, type Findable } from '@/together/join-gate';
import { canHostAudio, nearby, nearbySupported } from '@/together/nearby';
import { closeTogetherSheet, openTogetherSheet, type SheetPlace, togetherState } from '@/together/store';
import { syncPlay, syncPlaySupported } from '@/together/syncplay';

import { ChoiceRow, makeStyles, RowIcon, Section } from './together-parts';

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);
const AUDIO_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum']);

/** What a new session plays: a video, an audio item, or (item null) the audio queue that plays now. */
export type StartTarget = { kind: 'video'; item: BaseItemDto } | { kind: 'audio'; item: BaseItemDto | null };

export function targetFor(item: BaseItemDto | null, where: SheetPlace): StartTarget | null {
  if (where === 'music') return { kind: 'audio', item: null };
  if (!item) return null;
  if (VIDEO_TYPES.has(item.Type ?? '')) return { kind: 'video', item };
  if (isAudioItem(item) || AUDIO_TYPES.has(item.Type ?? '') || (item.Type === 'Playlist' && item.MediaType === 'Audio')) return { kind: 'audio', item };
  return null;
}

function targetTitle(t: StartTarget): string {
  if (t.item) return t.item.Name ?? 'This item';
  return audioState().queue.source?.name ?? 'The music that plays now';
}

function isDownloaded(id: string | null | undefined): boolean {
  return findDownload(id)?.state === 'completed';
}

/** The host has every file of the target on this device. */
function targetDownloaded(t: StartTarget): boolean {
  if (t.item) return isDownloaded(t.item.Id);
  const entries = audioState().queue.entries;
  return entries.length > 0 && entries.every((e) => isDownloaded(e.item.Id));
}

/** The target is on the signed-in server. */
function targetOnServer(t: StartTarget): boolean {
  const session = useSessionStore.getState().session;
  if (!session) return false;
  const serverId = t.item ? t.item.ServerId : audioState().queue.entries[audioState().queue.index]?.item.ServerId;
  return !serverId || serverId === session.serverId;
}

// ---- Picker ----------------------------------------------------------------------

function usePickerLists(kind: 'video' | 'audio', term: string, offline: boolean) {
  const session = useSession();
  const api = useMemo(() => (session ? getApi(session.serverUrl, session.token) : null), [session]);
  const online = !!api && !offline;
  const key = [session?.serverId ?? '', session?.userId ?? '', kind] as const;
  const resume = useQuery({
    queryKey: ['together-picker', ...key, 'resume'],
    queryFn: () => jf.getResume(api!, session!.userId, kind === 'video' ? 'Video' : 'Audio'),
    enabled: online,
  });
  const recent = useQuery({ queryKey: ['together-picker', ...key, 'recent'], queryFn: () => jf.getPickerItems(api!, session!.userId, kind), enabled: online });
  const t = term.trim();
  const search = useQuery({
    queryKey: ['together-picker', ...key, 'search', t],
    queryFn: ({ signal }) => jf.search(api!, session!.userId, t, signal),
    enabled: online && t.length >= 2,
  });
  const records = useDownloadsStore((s) => s.records);
  const fits = (i: BaseItemDto) => (kind === 'video' ? VIDEO_TYPES.has(i.Type ?? '') : AUDIO_TYPES.has(i.Type ?? ''));
  const downloads = useMemo(() => {
    const list =
      t.length >= 2
        ? searchDownloads(records, t)
        : Object.values(records)
            .filter((r) => r.state === 'completed')
            .map((r) => r.item);
    return list.filter(fits).slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, t, kind]);
  return {
    searching: t.length >= 2,
    loading: online && (resume.isPending || recent.isPending),
    resume: (resume.data ?? []).filter(fits),
    recent: (recent.data ?? []).filter(fits),
    search: (search.data ?? []).filter(fits),
    searchLoading: online && t.length >= 2 && search.isFetching,
    downloads,
  };
}

function PickRow({ item, onPick, last }: { item: BaseItemDto; onPick: (i: BaseItemDto) => void; last: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const audio = !VIDEO_TYPES.has(item.Type ?? '');
  const detail = [
    item.SeriesName,
    item.Type === 'Episode' ? null : item.ProductionYear,
    item.AlbumArtist ?? item.Artists?.[0],
    isDownloaded(item.Id) ? 'Downloaded' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => onPick(item)}
      accessibilityRole="button"
      accessibilityLabel={`Start with ${item.Name ?? 'this item'}`}
      style={({ pressed }) => [s.row, !last && s.rowLine, pressed && { backgroundColor: c.surface2 }]}>
      <ItemImage item={item} variant={audio ? 'square' : 'poster'} width={audio ? 40 : 30} aspectRatio={audio ? 1 : 2 / 3} rounded={6} hideArtTitle />
      <View style={s.rowText}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {item.Name ?? 'Untitled'}
        </Text>
        {detail ? (
          <Text style={s.rowDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron.right" size={13} color={c.text3} weight="semibold" />
    </Pressable>
  );
}

function PickList({ title, items, onPick }: { title: string; items: BaseItemDto[]; onPick: (i: BaseItemDto) => void }) {
  const s = useStyles(makeStyles);
  if (!items.length) return null;
  return (
    <Section title={title}>
      <View style={s.group}>
        {items.map((it, i) => (
          <PickRow key={`${it.Id}-${i}`} item={it} onPick={onPick} last={i === items.length - 1} />
        ))}
      </View>
    </Section>
  );
}

/** Pick what the new session plays: Continue watching, Recently added, Downloads, or a search. Music: Recently played and downloaded music. */
export function StartPicker({
  onPick,
  onBack,
  offline,
  fixedKind,
}: {
  onPick: (t: StartTarget) => void;
  onBack: () => void;
  offline: boolean;
  fixedKind?: 'video' | 'audio';
}) {
  const s = useStyles(makeStyles);
  const { c, scheme } = useTheme();
  const [kind, setKind] = useState<'video' | 'audio'>(fixedKind ?? 'video');
  const [text, setText] = useState('');
  const term = useDebounced(text, 300);
  const lists = usePickerLists(kind, term, offline);
  const pick = (item: BaseItemDto) => {
    const t = targetFor(item, 'hub');
    if (t) onPick(t);
  };
  const nothing = !lists.loading && !lists.resume.length && !lists.recent.length && !lists.downloads.length && !lists.search.length;
  return (
    <>
      <View style={s.buttonRow}>
        <Button title="Back" variant="smallTonal" icon="chevron.left" onPress={onBack} />
      </View>
      <Section title="What do you want to play?">
        {fixedKind ? null : (
          <View style={s.buttonRow}>
            <Button title="Video" variant={kind === 'video' ? 'small' : 'smallTonal'} icon="film" onPress={() => setKind('video')} />
            <Button title="Music" variant={kind === 'audio' ? 'small' : 'smallTonal'} icon="music.note" onPress={() => setKind('audio')} />
          </View>
        )}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={kind === 'video' ? 'Search films and episodes' : 'Search music'}
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          cursorColor={c.accent}
          keyboardAppearance={scheme}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search"
          style={[s.codeInput, s.searchInput]}
        />
      </Section>
      {lists.searching ? (
        <>
          {lists.searchLoading ? <ActivityIndicator color={c.text3} /> : null}
          <PickList title="Results" items={lists.search} onPick={pick} />
          <PickList title="Downloads" items={lists.downloads} onPick={pick} />
        </>
      ) : (
        <>
          {lists.loading ? <ActivityIndicator color={c.text3} /> : null}
          <PickList title={kind === 'video' ? 'Continue watching' : 'Continue listening'} items={lists.resume} onPick={pick} />
          <PickList title={kind === 'video' ? 'Recently added' : 'Recently played'} items={lists.recent} onPick={pick} />
          <PickList title={kind === 'video' ? 'Downloads' : 'Downloaded music'} items={lists.downloads} onPick={pick} />
        </>
      )}
      {nothing ? (
        <Text style={s.note}>{offline ? 'You are offline. Download something first, or search when you are online.' : 'Nothing here yet. Search for it.'}</Text>
      ) : null}
    </>
  );
}

// ---- Who can join? ---------------------------------------------------------------

/** After a pick: who can join, and (nearby) who can find it. Then Start. */
export function WhoStep({
  target,
  where,
  offline,
  networkType,
  onBack,
}: {
  target: StartTarget;
  where: SheetPlace;
  offline: boolean;
  networkType: string | null;
  onBack: (() => void) | null;
}) {
  const s = useStyles(makeStyles);
  const session = useSession();
  const serverName = session?.serverName ?? null;
  const downloaded = targetDownloaded(target);
  const who = whoCanJoin({
    nearbyOn: nearbySupported,
    signedIn: !!session && syncPlaySupported,
    offline,
    serverName,
    onServer: targetOnServer(target),
    downloaded,
  });
  const [choice, setChoice] = useState<Transport | null>(who.initial);
  const [findable, setFindable] = useState<Findable>(() => defaultFindable({ networkType, hotspot: !!togetherState().hotspot }));
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      await startSession(target, choice, findable, where);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {onBack ? (
        <View style={s.buttonRow}>
          <Button title="Back" variant="smallTonal" icon="chevron.left" onPress={onBack} />
        </View>
      ) : null}
      <View style={[s.group, s.row]}>
        <RowIcon name={target.kind === 'audio' ? 'music.note' : 'film'} />
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={2}>
            {targetTitle(target)}
          </Text>
          <Text style={s.rowDetail}>{downloaded ? 'Downloaded on this device' : 'Streams from your server'}</Text>
        </View>
      </View>
      {who.options.length === 0 ? (
        <Text style={s.note}>
          {offline ? 'You are offline, and this is not downloaded. Download it first.' : 'Sign in to a server to start a session here.'}
        </Text>
      ) : (
        <Section
          title="Who can join?"
          footer={who.options.some((o) => o.id === 'server') ? 'Uses Jellyfin SyncPlay, so other Jellyfin apps can join too.' : undefined}>
          <View style={s.group}>
            {who.options.map((o, i) => (
              <ChoiceRow
                key={o.id}
                title={o.title}
                detail={o.detail}
                selected={choice === o.id}
                onPress={() => setChoice(o.id)}
                last={i === who.options.length - 1}
              />
            ))}
          </View>
        </Section>
      )}
      {choice === 'nearby' ? (
        <Section
          title="Who can find it"
          footer={
            findable === 'code'
              ? 'The session does not show nearby. People join with the QR code or the typed code.'
              : 'People nearby see it and ask to join. You accept each person.'
          }>
          <View style={s.group}>
            <ChoiceRow title="Anyone nearby" selected={findable === 'anyone'} onPress={() => setFindable('anyone')} />
            <ChoiceRow title="Only with my code" selected={findable === 'code'} onPress={() => setFindable('code')} last />
          </View>
        </Section>
      ) : null}
      <Button title="Start" icon="play.fill" loading={busy} disabled={!choice} onPress={() => void start()} />
    </>
  );
}

/** Waits until the full player shows (or gives up), then opens the session sheet on it. */
function openOnPlayer(place: 'player' | 'music'): void {
  const shown = () => playerState().presentation === 'full';
  if (shown()) {
    setTimeout(() => openTogetherSheet(place, null), 350);
    return;
  }
  const t = setTimeout(() => unsub(), 15_000);
  const unsub = usePlayerStore.subscribe(() => {
    if (!shown()) return;
    unsub();
    clearTimeout(t);
    setTimeout(() => openTogetherSheet(place, null), 350);
  });
}

/** Plays an audio item (album, playlist, track) when it does not play yet. */
async function playAudio(item: BaseItemDto): Promise<void> {
  if (audioState().queue.source?.id === item.Id && playerState().now?.kind === 'audio') return;
  if (playerState().now?.kind === 'video') await videoSession().stop();
  await audioSession().play({ item });
}

/** Starts the session the user chose. The sheet then shows the host view. */
export async function startSession(target: StartTarget, transport: Transport, findable: Findable, where: SheetPlace): Promise<void> {
  if (transport === 'nearby') {
    nearby().setFindable(findable);
    if (target.kind === 'video') {
      const onPlayer = where === 'player';
      if (!onPlayer) closeTogetherSheet();
      await nearby().host(target.item);
      if (!onPlayer && togetherState().role === 'host') openOnPlayer('player');
      return;
    }
    if (target.item) await playAudio(target.item);
    if (canHostAudio()) await nearby().hostAudio();
    else toast('Play it first, then start the session.');
    return;
  }
  // Through the server (Jellyfin SyncPlay).
  void nearby().stopAll();
  if (target.kind === 'video') {
    const onPlayer = where === 'player';
    if (!onPlayer) closeTogetherSheet();
    await syncPlay().create(target.item);
    if (!onPlayer) openOnPlayer('player');
    return;
  }
  if (target.item) await syncPlay().create(target.item);
  else await syncPlay().createForAudio();
}
