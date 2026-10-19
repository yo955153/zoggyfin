/**
 * The release notes of a desktop update (pure). `latest.json` `notes` comes
 * from `desktop/CHANGELOG.md` (the section of the version; see
 * `desktop/scripts/publish.sh`): one short line per item.
 */

/** The card shows this many lines; more lines go behind "Show all". */
export const NOTES_INLINE_MAX = 4;
/** The card keeps at most this many lines. */
export const NOTES_MAX = 12;
const LINE_MAX = 140;

/** The lines of "What is new". Empty when there are no notes, or only "Zoggyfin X.Y.Z". */
export function parseReleaseNotes(notes: string | null | undefined): string[] {
  const text = (notes ?? '').trim();
  if (!text || /^Zoggyfin\s+v?\d[\w.+-]*$/i.test(text)) return [];
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line)) continue;
    line = line
      .replace(/^(?:[-*+•]|\d{1,2}[.)])\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();
    if (!line) continue;
    if (line.length > LINE_MAX) line = `${line.slice(0, LINE_MAX - 1).trimEnd()}…`;
    lines.push(line);
    if (lines.length === NOTES_MAX) break;
  }
  return lines;
}

/** "12.3 MB of 40.0 MB" (or "12.3 MB" when the size is not known). */
export function progressLabel(done: number, total: number): string {
  const mb = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;
  return total > 0 ? `${mb(Math.min(done, total))} of ${mb(total)}` : mb(done);
}

/** The part done, 0 to 1 (0 when the size is not known). */
export function progressFraction(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, done / total));
}
