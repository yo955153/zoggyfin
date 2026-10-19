import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Airplay,
  Captions,
  Check,
  ChevronDown,
  Gauge,
  type LucideIcon,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ComponentProps } from 'react';

import type { IconProps } from './icon';

type IonName = ComponentProps<typeof Ionicons>['name'];

/** SF Symbol name -> Ionicons name, for the web build. */
const MAP: Record<string, IonName> = {
  film: 'film-outline',
  tv: 'tv-outline',
  'square.stack': 'albums-outline',
  'music.note': 'musical-note',
  book: 'book-outline',
  'music.mic': 'mic-outline',
  'person.fill': 'person',
  'music.note.list': 'list',
  'square.stack.3d.up': 'layers-outline',
  guitars: 'musical-notes-outline',
  theatermasks: 'happy-outline',
  folder: 'folder-outline',
  'antenna.radiowaves.left.and.right': 'radio-outline',
  video: 'videocam-outline',
  photo: 'image-outline',
  'music.note.tv': 'musical-notes-outline',
  'square.grid.2x2': 'grid-outline',
  'wifi.exclamationmark': 'cloud-offline-outline',
  checkmark: 'checkmark',
  'chevron.right': 'chevron-forward',
  'chevron.down': 'chevron-down',
  'play.fill': 'play',
  heart: 'heart-outline',
  'heart.fill': 'heart',
  'ellipsis': 'ellipsis-horizontal',
  'arrow.down.circle': 'arrow-down-circle-outline',
  magnifyingglass: 'search',
  'clock.arrow.circlepath': 'time-outline',
  'line.3.horizontal.decrease': 'filter',
  'arrow.up.arrow.down': 'swap-vertical',
  xmark: 'close',
  'xmark.circle.fill': 'close-circle',
  'person.crop.circle': 'person-circle-outline',
  'qrcode': 'qr-code-outline',
  server: 'server-outline',
  'rectangle.portrait.and.arrow.right': 'log-out-outline',
  'trash': 'trash-outline',
  'checkmark.circle.fill': 'checkmark-circle',
  'circle': 'ellipse-outline',
  'star.fill': 'star',
};

/**
 * SF Symbol name -> Lucide icon (the design system's web icon set). The
 * player uses these; other screens still use Ionicons until the restyle.
 * `filled` glyphs get a fill, like the SF `.fill` variants.
 */
const LUCIDE: Record<string, { icon: LucideIcon; filled?: boolean }> = {
  'play.fill': { icon: Play, filled: true },
  'pause.fill': { icon: Pause, filled: true },
  'forward.fill': { icon: SkipForward, filled: true },
  'gobackward.5': { icon: RotateCcw },
  'gobackward.10': { icon: RotateCcw },
  'gobackward.15': { icon: RotateCcw },
  'gobackward.30': { icon: RotateCcw },
  'gobackward.60': { icon: RotateCcw },
  'goforward.5': { icon: RotateCw },
  'goforward.10': { icon: RotateCw },
  'goforward.15': { icon: RotateCw },
  'goforward.30': { icon: RotateCw },
  'goforward.60': { icon: RotateCw },
  'arrow.counterclockwise': { icon: Undo2 },
  'player.xmark': { icon: X },
  'player.chevron.down': { icon: ChevronDown },
  'captions.bubble': { icon: Captions },
  gearshape: { icon: Settings },
  'pip.enter': { icon: PictureInPicture2 },
  'airplay.video': { icon: Airplay },
  'player.checkmark': { icon: Check },
  'speaker.wave.2.fill': { icon: Volume2 },
  'speaker.slash.fill': { icon: VolumeX },
  'arrow.up.left.and.arrow.down.right': { icon: Maximize },
  gauge: { icon: Gauge },
};

export function Icon({ name, size, color }: IconProps) {
  const lucide = LUCIDE[name];
  if (lucide) {
    const L = lucide.icon;
    return <L size={size} color={color} strokeWidth={1.75} fill={lucide.filled ? color : 'none'} aria-hidden />;
  }
  return <Ionicons name={MAP[name] ?? 'ellipse-outline'} size={size} color={color} />;
}
