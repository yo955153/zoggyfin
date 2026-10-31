/**
 * The audio and subtitle choices for IPTV titles (the tracks inside the
 * stream): the choice per provider and title (a film, a series, a channel),
 * and the languages the person picked last, for titles with no choice yet.
 * The data is versioned and holds no URLs or secrets. `migrateTrackPrefs`
 * never throws. Pure, so it is unit-tested.
 */
import type { EmbeddedTrack, EmbeddedTracks } from './engine-types';
import { baseLanguage } from './track-labels';

/** What identifies a track again in the next episode or the next play. */
export interface TrackPick {
  language: string | null;
  title: string | null;
  codec: string | null;
  forced: boolean;
}

export interface TitleChoice {
  audio?: TrackPick;
  /** 'off': subtitles were turned off. */
  subtitle?: TrackPick | 'off';
  /** When the choice changed (ms), so the oldest go first. */
  at: number;
}

export interface TrackPrefs {
  version: 1;
  /** The ISO 639-1 code of the audio language picked last, or null. */
  audioLanguage: string | null;
  /** The subtitle language picked last, 'off', or null for no choice yet. */
  subtitleLanguage: string | 'off' | null;
  /** By `titleKey()`. */
  titles: Record<string, TitleChoice>;
}

export const EMPTY_TRACK_PREFS: TrackPrefs = { version: 1, audioLanguage: null, subtitleLanguage: null, titles: {} };

/** The most titles kept; the oldest choices go first. */
export const MAX_TITLES = 400;

/** The key of a title: one choice for all the episodes of a series. */
export function titleKey(providerId: string, title: { kind: 'film' | 'series' | 'live'; id: string }): string {
  return `${providerId}|${title.kind}:${title.id}`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null;
}

function pick(raw: unknown): TrackPick | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return { language: str(r.language), title: str(r.title), codec: str(r.codec), forced: r.forced === true };
}

/** Saved data of any shape (or none) to the current version. Never throws. */
export function migrateTrackPrefs(raw: unknown): TrackPrefs {
  if (!raw || typeof raw !== 'object') return EMPTY_TRACK_PREFS;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return EMPTY_TRACK_PREFS;
  const titles: Record<string, TitleChoice> = {};
  if (r.titles && typeof r.titles === 'object') {
    for (const [key, value] of Object.entries(r.titles as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      const choice: TitleChoice = { at: typeof v.at === 'number' ? v.at : 0 };
      const audio = pick(v.audio);
      if (audio) choice.audio = audio;
      const subtitle = v.subtitle === 'off' ? 'off' : pick(v.subtitle);
      if (subtitle) choice.subtitle = subtitle;
      titles[key] = choice;
    }
  }
  const sub = r.subtitleLanguage;
  return {
    version: 1,
    audioLanguage: str(r.audioLanguage),
    subtitleLanguage: sub === 'off' ? 'off' : str(sub),
    titles,
  };
}

export function toPick(t: EmbeddedTrack): TrackPick {
  return { language: t.language, title: t.title, codec: t.codec, forced: t.isForced };
}

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/** The track that is the saved one again: the same language, then the closest title, forced flag and codec. */
export function matchPick(tracks: readonly EmbeddedTrack[], p: TrackPick): EmbeddedTrack | null {
  const lang = baseLanguage(p.language);
  let best: EmbeddedTrack | null = null;
  let bestScore = -1;
  for (const t of tracks) {
    const tl = baseLanguage(t.language);
    // With no language on either side, only the title can say it is the same track.
    if (lang ? tl !== lang : tl !== null || !p.title || !sameText(t.title, p.title)) continue;
    const score = (sameText(t.title, p.title) ? 4 : 0) + (t.isForced === p.forced ? 2 : 0) + (sameText(t.codec, p.codec) ? 1 : 0);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** A track in the language: the default one first, then a full (not forced) one. */
function byLanguage(tracks: readonly EmbeddedTrack[], language: string, forced: boolean): EmbeddedTrack | null {
  const all = tracks.filter((t) => baseLanguage(t.language) === language && t.isForced === forced);
  return all.find((t) => t.isDefault) ?? all[0] ?? null;
}

/**
 * The tracks to select when a title starts. `undefined`: leave the engine's
 * choice. The title's own choice comes first, then the languages picked
 * last. With no choice at all: the default subtitle, or a forced one in the
 * audio language (signs and foreign lines), else none.
 */
export function chooseTracks(tracks: EmbeddedTracks, prefs: TrackPrefs, key: string): { audioId?: string; subtitleId?: string | null } {
  const out: { audioId?: string; subtitleId?: string | null } = {};
  const title = prefs.titles[key];

  let audio: EmbeddedTrack | null = null;
  if (title?.audio) audio = matchPick(tracks.audio, title.audio);
  if (!audio && prefs.audioLanguage) audio = byLanguage(tracks.audio, prefs.audioLanguage, false);
  if (audio && audio.id !== tracks.audioId) out.audioId = audio.id;
  const playing = audio ?? tracks.audio.find((t) => t.id === tracks.audioId) ?? null;
  const forcedFor = () => {
    const lang = baseLanguage(playing?.language);
    return lang ? byLanguage(tracks.subtitles, lang, true) : null;
  };

  let sub: EmbeddedTrack | null | undefined;
  if (title?.subtitle === 'off') sub = null;
  else if (title?.subtitle) sub = matchPick(tracks.subtitles, title.subtitle) ?? undefined;
  if (sub === undefined) {
    if (prefs.subtitleLanguage === 'off') sub = forcedFor();
    else if (prefs.subtitleLanguage) sub = byLanguage(tracks.subtitles, prefs.subtitleLanguage, false) ?? forcedFor();
    else sub = tracks.subtitles.find((t) => t.isDefault && !t.isForced) ?? forcedFor();
  }
  const subId = sub ? sub.id : null;
  if (subId !== tracks.subtitleId) out.subtitleId = subId;
  return out;
}

/** Keeps the person's pick for the title and as the language for new titles. `track` null: subtitles off. */
export function rememberChoice(prefs: TrackPrefs, key: string, kind: 'audio' | 'subtitle', track: EmbeddedTrack | null, now: number): TrackPrefs {
  const prev = prefs.titles[key] ?? { at: now };
  const choice: TitleChoice = { ...prev, at: now };
  const next: TrackPrefs = { ...prefs, titles: { ...prefs.titles } };
  if (kind === 'audio') {
    if (!track) return prefs;
    choice.audio = toPick(track);
    next.audioLanguage = baseLanguage(track.language) ?? prefs.audioLanguage;
  } else if (!track) {
    choice.subtitle = 'off';
    next.subtitleLanguage = 'off';
  } else {
    choice.subtitle = toPick(track);
    // A forced subtitle is a part of the audio, not a language to read in.
    if (!track.isForced) next.subtitleLanguage = baseLanguage(track.language) ?? prefs.subtitleLanguage;
  }
  next.titles[key] = choice;
  const keys = Object.keys(next.titles);
  if (keys.length > MAX_TITLES) {
    keys
      .sort((a, b) => next.titles[a].at - next.titles[b].at)
      .slice(0, keys.length - MAX_TITLES)
      .forEach((k) => delete next.titles[k]);
  }
  return next;
}
