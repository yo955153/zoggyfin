/**
 * The Audio & Subtitles sheet for IPTV titles and channels: the tracks
 * inside the stream, as the engine lists them (`player/embedded-tracks.ts`).
 * The same sheet and row shapes as the Jellyfin tracks. Pure, so it is
 * unit-tested.
 */
import type { EmbeddedTracks } from '@/player/engine-types';
import { embeddedTrackLabels } from '@/player/track-labels';

import type { SheetSection } from './player-sheet';

export function embeddedTrackSections(
  tracks: EmbeddedTracks | null,
  select: { audio(id: string): void; subtitle(id: string | null): void },
): SheetSection[] {
  const t = tracks ?? { audio: [], subtitles: [], audioId: null, subtitleId: null };
  const audioLabels = embeddedTrackLabels(t.audio, 'audio');
  const subLabels = embeddedTrackLabels(t.subtitles, 'subtitle');
  return [
    {
      title: 'Audio',
      empty: 'The player lists no audio tracks for this stream',
      rows: t.audio.map((a, i) => ({
        key: `a${a.id}`,
        label: audioLabels[i],
        detail: a.isDefault ? 'Default' : null,
        selected: a.id === t.audioId,
        onPress: () => select.audio(a.id),
      })),
    },
    {
      title: 'Subtitles',
      empty: 'No subtitles in this stream',
      rows: t.subtitles.length
        ? [
            { key: 'off', label: 'Off', selected: t.subtitleId === null, onPress: () => select.subtitle(null) },
            ...t.subtitles.map((x, i) => ({
              key: `s${x.id}`,
              label: subLabels[i],
              detail: x.isDefault ? 'Default' : null,
              selected: x.id === t.subtitleId,
              onPress: () => select.subtitle(x.id),
            })),
          ]
        : [],
    },
  ];
}
