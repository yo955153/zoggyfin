import Ionicons from '@expo/vector-icons/Ionicons';
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

export function Icon({ name, size, color }: IconProps) {
  return <Ionicons name={MAP[name] ?? 'ellipse-outline'} size={size} color={color} />;
}
