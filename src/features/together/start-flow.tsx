/**
 * "Start a session" in the together sheet: one choice, "Who can join?".
 * The transport (nearby or the Jellyfin server) follows from that choice;
 * the user never picks "SyncPlay" or "LAN".
 *
 * A session is a room: it opens with no item, the sheet closes, and the
 * user picks what to play with the normal app (the Play buttons play for
 * everyone). The shortcuts ("Watch together" on an item page, the pill in a
 * player) open a room that starts with that item.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useSession, useSessionStore } from '@/auth/session-store';
import { Button } from '@/components/button';
import { findDownload } from '@/downloads';
import { isAudioItem, playHere } from '@/player';
import { audioState } from '@/player/audio/store';
import { playerState } from '@/player/store';
import { useStyles } from '@/theme';
import { whoCanJoin, type Transport } from '@/together/hub';
import { defaultFindable, type Findable } from '@/together/join-gate';
import { nearby, nearbySupported } from '@/together/nearby';
import { closeTogetherSheet, type SheetPlace, togetherState } from '@/together/store';
import { syncPlay, syncPlaySupported } from '@/together/syncplay';

import { ChoiceRow, makeStyles, RowIcon, Section } from './together-parts';

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);
const AUDIO_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum']);

/** What a new session starts with: a video, an audio item, or (item null) the audio queue that plays now. No target: an empty room. */
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
function targetDownloaded(t: StartTarget | null): boolean {
  if (!t) return false;
  if (t.item) return isDownloaded(t.item.Id);
  const entries = audioState().queue.entries;
  return entries.length > 0 && entries.every((e) => isDownloaded(e.item.Id));
}

/** The target is on the signed-in server (an empty room: the server can hold it). */
function targetOnServer(t: StartTarget | null): boolean {
  const session = useSessionStore.getState().session;
  if (!session) return false;
  if (!t) return true;
  const serverId = t.item ? t.item.ServerId : audioState().queue.entries[audioState().queue.index]?.item.ServerId;
  return !serverId || serverId === session.serverId;
}

// ---- Who can join? ---------------------------------------------------------------

/** Who can join, and (nearby) who can find it. Then Start. No target: an empty room. */
export function WhoStep({
  target,
  where,
  offline,
  networkType,
  onBack,
}: {
  target: StartTarget | null;
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
    room: !target,
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
      {target ? (
        <View style={[s.group, s.row]}>
          <RowIcon name={target.kind === 'audio' ? 'music.note' : 'film'} />
          <View style={s.rowText}>
            <Text style={s.rowTitle} numberOfLines={2}>
              {targetTitle(target)}
            </Text>
            <Text style={s.rowDetail}>{downloaded ? 'Downloaded on this device' : 'Streams from your server'}</Text>
          </View>
        </View>
      ) : (
        <Text style={s.note}>You open the session first. Then pick something to play anywhere in the app, and it plays for everyone.</Text>
      )}
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
      <Button title={target ? 'Start' : 'Open the session'} icon={target ? 'play.fill' : 'person.2.fill'} loading={busy} disabled={!choice} onPress={() => void start()} />
    </>
  );
}

/** True when the target plays already (the pill in a player): the room starts with it, with no reload. */
function playsNow(target: StartTarget | null, where: SheetPlace): boolean {
  const now = playerState().now;
  if (!target || !now) return false;
  if (target.kind === 'audio') return now.kind === 'audio' && (!target.item || audioState().queue.source?.id === target.item.Id || now.item.Id === target.item.Id);
  return now.kind === 'video' && (where === 'player' || now.item.Id === target.item.Id);
}

/**
 * Opens the session the user chose and closes the sheet. A target that plays
 * already stays as it is; another target starts in the room (for everyone).
 */
export async function startSession(target: StartTarget | null, transport: Transport, findable: Findable, where: SheetPlace): Promise<void> {
  const adopt = playsNow(target, where);
  const item = target?.item ?? null;
  if (transport === 'nearby') {
    nearby().setFindable(findable);
    if (!(await nearby().openRoom({ adopt }))) return;
    closeTogetherSheet();
    if (item && !adopt) playHere(isAudioItem(item) ? { item } : { item, autoplay: false });
    return;
  }
  // Through the server (Jellyfin SyncPlay): the group is the room.
  void nearby().stopAll();
  closeTogetherSheet();
  if (adopt && target?.kind === 'audio') await syncPlay().createForAudio();
  else await syncPlay().create(adopt ? (playerState().now?.item ?? null) : item);
}
