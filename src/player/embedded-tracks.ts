/**
 * Turns each engine's own track lists into one shape (`EmbeddedTracks`):
 * hls.js playlists, the media element's AudioTrackList and TextTrackList,
 * expo-video's tracks and libmpv's `track-list`. The engines keep the ids;
 * only the engine that made an id reads it back.
 * Pure, so it is unit-tested.
 */
import type { EmbeddedTrack, EmbeddedTracks } from './engine-types';

/** An hls.js media playlist (an `EXT-X-MEDIA` rendition): the fields used here. */
export interface HlsPlaylistLike {
  name?: string;
  lang?: string;
  default?: boolean;
  forced?: boolean;
  audioCodec?: string;
  textCodec?: string;
}

/**
 * hls.js: the ids are the indexes in `hls.audioTracks` and
 * `hls.subtitleTracks` (what `hls.audioTrack` and `hls.subtitleTrack` take).
 * `subtitleIndex` -1 is off.
 */
export function fromHls(
  audio: readonly HlsPlaylistLike[],
  audioIndex: number,
  subtitles: readonly HlsPlaylistLike[],
  subtitleIndex: number,
): EmbeddedTracks {
  const map = (p: HlsPlaylistLike, i: number, codec: string | undefined): EmbeddedTrack => ({
    id: String(i),
    title: p.name?.trim() || null,
    language: p.lang?.trim() || null,
    codec: codec || null,
    isDefault: !!p.default,
    isForced: !!p.forced,
  });
  return {
    audio: audio.map((p, i) => map(p, i, p.audioCodec)),
    subtitles: subtitles.map((p, i) => map(p, i, p.textCodec)),
    audioId: audioIndex >= 0 && audioIndex < audio.length ? String(audioIndex) : null,
    subtitleId: subtitleIndex >= 0 && subtitleIndex < subtitles.length ? String(subtitleIndex) : null,
  };
}

/** A media element `AudioTrack` (Safari) or `TextTrack`: the fields used here. */
export interface ElementTrackLike {
  id: string;
  kind: string;
  label: string;
  language: string;
  /** AudioTrack. */
  enabled?: boolean;
  /** TextTrack: `showing`, `hidden` or `disabled`. */
  mode?: string;
}

/** Text tracks that are subtitles (not chapters or metadata). */
const SUBTITLE_KINDS = new Set(['subtitles', 'captions', 'forced']);

/**
 * The media element (Safari, a browser with AudioTrackList): ids are the
 * positions in the lists (a track's own `id` can be empty or repeat).
 */
export function fromMediaElement(audio: readonly ElementTrackLike[], text: readonly ElementTrackLike[]): EmbeddedTracks {
  const subs = text.map((t, i) => ({ t, i })).filter(({ t }) => SUBTITLE_KINDS.has(t.kind));
  const audioSel = audio.findIndex((t) => t.enabled);
  const subSel = subs.find(({ t }) => t.mode === 'showing');
  return {
    audio: audio.map((t, i) => ({
      id: String(i),
      title: t.label.trim() || null,
      language: t.language.trim() || null,
      codec: null,
      isDefault: t.kind === 'main',
      isForced: false,
    })),
    subtitles: subs.map(({ t, i }) => ({
      id: String(i),
      title: t.label.trim() || null,
      language: t.language.trim() || null,
      codec: null,
      isDefault: false,
      isForced: t.kind === 'forced',
    })),
    audioId: audioSel >= 0 ? String(audioSel) : null,
    subtitleId: subSel ? String(subSel.i) : null,
  };
}

/** An expo-video `AudioTrack` or `SubtitleTrack`: the fields used here. */
export interface ExpoTrackLike {
  id?: string;
  language?: string | null;
  label?: string | null;
  name?: string | null;
  isDefault?: boolean;
}

/**
 * expo-video's id for a track: Android gives one; iOS does not, and iOS
 * picks a track by its label and language, which this id holds.
 */
export function expoTrackId(t: ExpoTrackLike, index: number): string {
  return t.id ? `id:${t.id}` : `ix:${index}:${t.language ?? ''}:${t.label ?? ''}`;
}

/**
 * expo-video. `label` is the language in the device's language (made by the
 * player), so the track title is `name`; the app names the language itself.
 */
export function fromExpoVideo(
  audio: readonly ExpoTrackLike[],
  audioSel: ExpoTrackLike | null | undefined,
  subtitles: readonly ExpoTrackLike[],
  subtitleSel: ExpoTrackLike | null | undefined,
): EmbeddedTracks {
  const map = (t: ExpoTrackLike, i: number): EmbeddedTrack => ({
    id: expoTrackId(t, i),
    title: t.name?.trim() || null,
    language: t.language?.trim() || null,
    codec: null,
    isDefault: !!t.isDefault,
    isForced: false,
  });
  const find = (list: readonly ExpoTrackLike[], sel: ExpoTrackLike | null | undefined): string | null => {
    if (!sel) return null;
    const i = list.findIndex((t) => (sel.id ? t.id === sel.id : t.label === sel.label && t.language === sel.language));
    return i >= 0 ? expoTrackId(list[i], i) : null;
  };
  return {
    audio: audio.map(map),
    subtitles: subtitles.map(map),
    audioId: find(audio, audioSel),
    subtitleId: find(subtitles, subtitleSel),
  };
}

/** A libmpv `track-list` entry: the fields used here. */
export interface MpvTrackLike {
  id: number | null;
  type: 'video' | 'audio' | 'sub' | null;
  external: boolean;
  title: string | null;
  lang: string | null;
  codec: string | null;
  selected: boolean;
  /** Newer desktop builds only. */
  isDefault?: boolean;
  forced?: boolean;
}

/** libmpv: ids are libmpv's track ids (what `aid` and `sid` take). Subtitle files added later are left out. */
export function fromMpv(tracks: readonly MpvTrackLike[]): EmbeddedTracks {
  const of = (type: 'audio' | 'sub') => tracks.filter((t) => t.type === type && !t.external && t.id !== null);
  const map = (t: MpvTrackLike): EmbeddedTrack => ({
    id: String(t.id),
    title: t.title?.trim() || null,
    language: t.lang?.trim() || null,
    codec: t.codec || null,
    isDefault: !!t.isDefault,
    isForced: !!t.forced,
  });
  const audio = of('audio');
  const subs = of('sub');
  const audioSel = audio.find((t) => t.selected);
  const subSel = subs.find((t) => t.selected);
  return {
    audio: audio.map(map),
    subtitles: subs.map(map),
    audioId: audioSel ? String(audioSel.id) : null,
    subtitleId: subSel ? String(subSel.id) : null,
  };
}

/** Two lists that would show the same sheet: an engine repeats a list, and nothing needs to change. */
export function sameEmbeddedTracks(a: EmbeddedTracks, b: EmbeddedTracks): boolean {
  if (a.audioId !== b.audioId || a.subtitleId !== b.subtitleId) return false;
  const eq = (x: EmbeddedTrack[], y: EmbeddedTrack[]) =>
    x.length === y.length &&
    x.every((t, i) => {
      const u = y[i];
      return t.id === u.id && t.title === u.title && t.language === u.language && t.codec === u.codec && t.isDefault === u.isDefault && t.isForced === u.isForced;
    });
  return eq(a.audio, b.audio) && eq(a.subtitles, b.subtitles);
}

/** Live channels show the button only when there is a choice: two audio tracks, or a subtitle. */
export function hasTrackChoice(t: EmbeddedTracks | null): boolean {
  return !!t && (t.audio.length > 1 || t.subtitles.length > 0);
}
