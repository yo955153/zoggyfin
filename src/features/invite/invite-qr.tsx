/**
 * The QR code of an invite link, drawn with Views (no SVG, no native
 * module). Black on white with a quiet zone of 4 modules, as cameras need.
 * The link is ASCII, so the library's byte mode reads it as it is.
 */
import qrFactory from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';

const QUIET = 4;

/** For each row, the runs of dark modules as [start, length]. */
export function qrRows(value: string): { count: number; rows: [number, number][][] } {
  const qr = qrFactory(0, 'M');
  qr.addData(value, 'Byte');
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

export function InviteQr({ value, size, label }: { value: string; size: number; label: string }) {
  const m = useMemo(() => qrRows(value), [value]);
  const cell = Math.max(1, Math.floor(size / (m.count + QUIET * 2)));
  const side = cell * (m.count + QUIET * 2);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: side, height: side, padding: cell * QUIET, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
      {m.rows.map((runs, r) => (
        <View key={r} style={{ height: cell, width: cell * m.count }}>
          {runs.map(([start, len]) => (
            <View key={start} style={{ position: 'absolute', top: 0, left: start * cell, width: len * cell, height: cell, backgroundColor: '#000000' }} />
          ))}
        </View>
      ))}
    </View>
  );
}
