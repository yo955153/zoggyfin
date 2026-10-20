/**
 * A QR code drawn with Views (no SVG, no native module), so it works on
 * iOS, Android, TV and web. Always black on white with a quiet zone of
 * 4 modules: cameras need that.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import qrFactory from 'qrcode-generator';

import { createStyles, radius, useStyles } from '@/theme';

/** The white border around the code, in modules. */
export const QUIET_ZONE = 4;

/** The UTF-8 bytes of a string, one byte per character (the library reads `charCode & 0xff`). */
function utf8Binary(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out += String.fromCharCode(cp);
    else if (cp < 0x800) out += String.fromCharCode(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out += String.fromCharCode(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out += String.fromCharCode(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return out;
}

export interface QrMatrix {
  /** The number of modules on one side (no quiet zone). */
  count: number;
  /** For each row, the runs of dark modules as [start column, length]. */
  rows: [number, number][][];
}

/** The QR matrix of a value (error correction M, size picked by the library), as runs of dark modules. */
export function qrRuns(value: string): QrMatrix {
  const qr = qrFactory(0, 'M');
  qr.addData(utf8Binary(value), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const rows: [number, number][][] = [];
  for (let r = 0; r < count; r++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let c = 0; c <= count; c++) {
      const dark = c < count && qr.isDark(r, c);
      if (dark && start < 0) start = c;
      else if (!dark && start >= 0) {
        runs.push([start, c - start]);
        start = -1;
      }
    }
    rows.push(runs);
  }
  return { count, rows };
}

export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const s = useStyles(makeStyles);
  const matrix = useMemo(() => qrRuns(value), [value]);
  const cell = Math.max(1, Math.floor(size / (matrix.count + QUIET_ZONE * 2)));
  const side = cell * (matrix.count + QUIET_ZONE * 2);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[s.box, { width: side, height: side, padding: cell * QUIET_ZONE }]}
    >
      {matrix.rows.map((runs, r) => (
        <View key={r} style={{ height: cell, width: cell * matrix.count }}>
          {runs.map(([start, len]) => (
            <View key={start} style={[s.dark, { left: start * cell, width: len * cell, height: cell }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = createStyles(() => ({
  box: { backgroundColor: '#FFFFFF', borderRadius: radius.md, overflow: 'hidden' as const },
  dark: { position: 'absolute' as const, top: 0, backgroundColor: '#000000' },
}));
