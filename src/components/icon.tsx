import { type SFSymbol, SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { ANDROID_SYMBOLS, type IconName, isIconName } from './icon-names';

export type { IconName } from './icon-names';

export interface IconProps {
  /** An icon name (an SF Symbol name). Unknown names draw a neutral circle. */
  name: IconName;
  size: number;
  color: string;
  weight?: 'regular' | 'semibold' | 'bold';
}

/**
 * The one icon component (design system §5). Apple: SF Symbols. Android:
 * Material Symbols through the same view. Web: Lucide (icon.web.tsx).
 * Icons are decorative: the control around them carries the label.
 */
export function Icon({ name, size, color, weight }: IconProps) {
  const known = isIconName(name) ? name : 'circle';
  return (
    <SymbolView
      name={{ ios: known as SFSymbol, android: ANDROID_SYMBOLS[known] }}
      size={size}
      tintColor={color}
      weight={weight}
      type="monochrome"
      accessible={false}
      importantForAccessibility="no"
      fallback={<View style={{ width: size, height: size }} />}
    />
  );
}
