/**
 * Readable names for the tracks inside a stream: language codes (ISO 639-1,
 * 639-2/B and /T, with a region such as `pt-BR`), codec names and track
 * titles become "English", "French (Forced)", "Arabic · AC3" or "Track 2".
 * No Intl.DisplayNames: Hermes does not have it. British spelling.
 * Pure, so it is unit-tested.
 */
import type { EmbeddedTrack } from './engine-types';

/** Language names by ISO 639-1 code. */
const NAMES: Record<string, string> = {
  af: 'Afrikaans', am: 'Amharic', ar: 'Arabic', az: 'Azerbaijani', be: 'Belarusian', bg: 'Bulgarian', bn: 'Bengali',
  bs: 'Bosnian', ca: 'Catalan', cs: 'Czech', cy: 'Welsh', da: 'Danish', de: 'German', el: 'Greek', en: 'English',
  es: 'Spanish', et: 'Estonian', eu: 'Basque', fa: 'Persian', fi: 'Finnish', fil: 'Filipino', fr: 'French',
  ga: 'Irish', gl: 'Galician', gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian',
  hy: 'Armenian', id: 'Indonesian', is: 'Icelandic', it: 'Italian', ja: 'Japanese', ka: 'Georgian', kk: 'Kazakh',
  km: 'Khmer', kn: 'Kannada', ko: 'Korean', ku: 'Kurdish', lt: 'Lithuanian', lv: 'Latvian', mk: 'Macedonian',
  ml: 'Malayalam', mn: 'Mongolian', mr: 'Marathi', ms: 'Malay', mt: 'Maltese', my: 'Burmese', nb: 'Norwegian Bokmål',
  ne: 'Nepali', nl: 'Dutch', nn: 'Norwegian Nynorsk', no: 'Norwegian', pa: 'Punjabi', pl: 'Polish', ps: 'Pashto',
  pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', si: 'Sinhala', sk: 'Slovak', sl: 'Slovenian', so: 'Somali',
  sq: 'Albanian', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil', te: 'Telugu', th: 'Thai', tl: 'Tagalog',
  tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', zh: 'Chinese', zu: 'Zulu',
};

/** ISO 639-2 codes (both the B and the T forms) to ISO 639-1. */
const THREE: Record<string, string> = {
  afr: 'af', amh: 'am', ara: 'ar', aze: 'az', bel: 'be', bul: 'bg', ben: 'bn', bos: 'bs', cat: 'ca', cze: 'cs',
  ces: 'cs', wel: 'cy', cym: 'cy', dan: 'da', ger: 'de', deu: 'de', gre: 'el', ell: 'el', eng: 'en', spa: 'es',
  est: 'et', baq: 'eu', eus: 'eu', per: 'fa', fas: 'fa', fin: 'fi', fil: 'fil', fre: 'fr', fra: 'fr', gle: 'ga',
  glg: 'gl', guj: 'gu', heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu', arm: 'hy', hye: 'hy', ind: 'id', ice: 'is',
  isl: 'is', ita: 'it', jpn: 'ja', geo: 'ka', kat: 'ka', kaz: 'kk', khm: 'km', kan: 'kn', kor: 'ko', kur: 'ku',
  lit: 'lt', lav: 'lv', mac: 'mk', mkd: 'mk', mal: 'ml', mon: 'mn', mar: 'mr', may: 'ms', msa: 'ms', mlt: 'mt',
  bur: 'my', mya: 'my', nep: 'ne', dut: 'nl', nld: 'nl', nob: 'nb', nno: 'nn', nor: 'no', pan: 'pa', pol: 'pl',
  pus: 'ps', por: 'pt', rum: 'ro', ron: 'ro', rus: 'ru', sin: 'si', slo: 'sk', slk: 'sk', slv: 'sl', som: 'so',
  alb: 'sq', sqi: 'sq', srp: 'sr', swe: 'sv', swa: 'sw', tam: 'ta', tel: 'te', tha: 'th', tgl: 'tl', tur: 'tr',
  ukr: 'uk', urd: 'ur', uzb: 'uz', vie: 'vi', chi: 'zh', zho: 'zh', zul: 'zu',
};

/** Codes that name no language: undetermined, no linguistic content, multiple. */
const NO_LANGUAGE = new Set(['und', 'zxx', 'mis', 'xx', 'unk', 'mul']);

/** Regions that change the name people know (Brazilian Portuguese, European Spanish). */
const REGIONS: Record<string, string> = {
  'pt-br': 'Portuguese (Brazil)', 'pt-pt': 'Portuguese (Portugal)', 'es-419': 'Spanish (Latin America)',
  'es-mx': 'Spanish (Mexico)', 'es-es': 'Spanish (Spain)', 'fr-ca': 'French (Canada)', 'en-gb': 'English (UK)',
  'en-us': 'English (US)', 'zh-hans': 'Chinese (Simplified)', 'zh-hant': 'Chinese (Traditional)', 'zh-tw': 'Chinese (Taiwan)',
  'zh-hk': 'Chinese (Hong Kong)', 'zh-cn': 'Chinese (China)',
};

/**
 * The ISO 639-1 code of a language code (`fre`, `FR`, `fr-CA`, `fra`), or
 * null when the code names no known language (`und`, empty, unknown).
 */
export function baseLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  if (!base || NO_LANGUAGE.has(base)) return null;
  if (NAMES[base]) return base;
  return THREE[base] ?? null;
}

/** "English", "Portuguese (Brazil)", or null for `und` and unknown codes. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.trim().toLowerCase().replace(/_/g, '-');
  if (REGIONS[key]) return REGIONS[key];
  const base = baseLanguage(key);
  return base ? NAMES[base] : null;
}

/** Codec names as people know them. Keys are lower case, without the profile part. */
const CODECS: Record<string, string> = {
  aac: 'AAC', 'mp4a.40': 'AAC', 'mp4a.40.2': 'AAC', 'mp4a.40.5': 'HE-AAC', 'mp4a.40.29': 'HE-AAC',
  ac3: 'AC3', 'ac-3': 'AC3', eac3: 'E-AC3', 'ec-3': 'E-AC3', dts: 'DTS', 'dts-hd': 'DTS-HD', dtshd: 'DTS-HD',
  truehd: 'TrueHD', mlp: 'TrueHD', mp3: 'MP3', 'mp4a.69': 'MP3', 'mp4a.6b': 'MP3', mp2: 'MP2', opus: 'Opus',
  vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', pcm: 'PCM',
  subrip: 'SRT', srt: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'WebVTT', wvtt: 'WebVTT', mov_text: 'Text', tx3g: 'Text',
  stpp: 'TTML', ttml: 'TTML', hdmv_pgs_subtitle: 'PGS', pgssub: 'PGS', pgs: 'PGS', dvb_subtitle: 'DVB',
  dvbsub: 'DVB', dvd_subtitle: 'VobSub', vobsub: 'VobSub', dvb_teletext: 'Teletext', eia_608: 'CC', eia_708: 'CC',
};

/** "AC3", "AAC", "PGS"; null when the codec is not known. */
export function codecName(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const c = codec.trim().toLowerCase().replace(/^(audio|text|application)\//, '').replace(/^x-/, '');
  if (CODECS[c]) return CODECS[c];
  // `mp4a.40.2`-style codec strings with a profile the table does not know.
  const head = c.split('.').slice(0, 2).join('.');
  if (CODECS[head]) return CODECS[head];
  const first = c.split(/[.,]/)[0];
  return CODECS[first] ?? null;
}

/** Subtitles drawn as pictures (Blu-ray PGS, DVB, DVD VobSub). */
export function isImageSubtitle(codec: string | null | undefined): boolean {
  const name = codecName(codec);
  return name === 'PGS' || name === 'DVB' || name === 'VobSub';
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A title that only repeats the language ("English", "eng", "en") adds nothing. */
function usefulTitle(title: string | null, language: string | null): string | null {
  const t = title?.trim();
  if (!t) return null;
  const name = languageName(language);
  if (name && (same(t, name) || same(t, language ?? '') || baseLanguage(t) === baseLanguage(language))) return null;
  if (!name && language && same(t, language)) return null;
  return t;
}

/**
 * The label of one track. `ordinal` counts from 1 among the tracks of the
 * same kind ("Track 2", "Subtitle 2" when nothing else is known).
 */
export function embeddedTrackLabel(t: EmbeddedTrack, kind: 'audio' | 'subtitle', ordinal: number): string {
  const name = languageName(t.language);
  const title = usefulTitle(t.title, t.language);
  // A title that names the language better (an unknown code): the title alone.
  let base = name ?? title ?? (t.language && !baseLanguage(t.language) && !NO_LANGUAGE.has(t.language.toLowerCase()) ? t.language : null);
  if (name && title && !title.toLowerCase().includes(name.toLowerCase())) base = `${name} · ${title}`;
  else if (name && title) base = title;
  if (!base) base = kind === 'audio' ? `Track ${ordinal}` : `Subtitle ${ordinal}`;
  if (t.isForced && !/forced/i.test(base)) base = `${base} (Forced)`;
  const codec = codecName(t.codec);
  return codec && !base.includes(codec) ? `${base} · ${codec}` : base;
}

/**
 * Labels for a list of tracks, in order. Two tracks with the same label get
 * their number, so the choice is never between two equal rows.
 */
export function embeddedTrackLabels(tracks: readonly EmbeddedTrack[], kind: 'audio' | 'subtitle'): string[] {
  const labels = tracks.map((t, i) => embeddedTrackLabel(t, kind, i + 1));
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return labels.map((l, i) => ((counts.get(l) ?? 0) > 1 && !/^(Track|Subtitle) \d+$/.test(l) ? `${l} · ${kind === 'audio' ? 'Track' : 'Subtitle'} ${i + 1}` : l));
}
