import { type SFSymbol, SymbolView } from 'expo-symbols';
import { View } from 'react-native';

export interface IconProps {
  /**
   * An SF Symbol name. Web maps it to Lucide or Ionicons (see icon.web.tsx).
   * A `player.` prefix picks the Lucide glyph on web; native drops the prefix.
   */
  name: string;
  size: number;
  color: string;
  weight?: 'regular' | 'semibold' | 'bold';
}

export function Icon({ name, size, color, weight }: IconProps) {
  return (
    <SymbolView
      name={(name.startsWith('player.') ? name.slice('player.'.length) : name) as SFSymbol}
      size={size}
      tintColor={color}
      weight={weight}
      type="monochrome"
      fallback={<View style={{ width: size, height: size }} />}
    />
  );
}
