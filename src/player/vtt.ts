/**
 * A small WebVTT parser for text subtitles. The app draws the cues itself,
 * so subtitles look the same on iPhone, iPad and the web.
 */

export interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseTimestamp(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!m) return null;
  const [, h = '0', min = '0', s = '0', ms = '0'] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '‎', '&rlm;': '‏' };

/** Removes VTT tags (<i>, <c.x>, <00:01.000>) and decodes the basic entities. */
export function cleanCueText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (e) => ENTITIES[e] ?? e)
    .trim();
}

export function parseVtt(source: string): Cue[] {
  const lines = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const arrow = line.indexOf('-->');
    if (arrow === -1) {
      i++;
      continue;
    }
    const start = parseTimestamp(line.slice(0, arrow));
    // Cue settings ("line:90% align:center") follow the end time.
    const end = parseTimestamp(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? '');
    i++;
    const text: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      text.push(lines[i] ?? '');
      i++;
    }
    if (start !== null && end !== null && end > start) {
      const clean = cleanCueText(text.join('\n'));
      if (clean) cues.push({ start, end, text: clean });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The text of every cue showing at `t`, newest last. Cues are sorted by start. */
export function cuesAt(cues: readonly Cue[], t: number): string[] {
  // Binary search for the last cue that starts at or before t.
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((cues[mid]?.start ?? Infinity) <= t) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: string[] = [];
  // Overlapping cues are rare and short: look back a few.
  for (let k = last; k >= 0 && k > last - 8; k--) {
    const c = cues[k];
    if (c && t < c.end) out.unshift(c.text);
  }
  return out;
}
