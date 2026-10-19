import { type SFSymbol, SymbolView } from 'expo-symbols';
import { View } from 'react-native';

export interface IconProps {
  /** An SF Symbol name. Web maps it to a close Ionicons glyph (see icon.web.tsx). */
  name: string;
  size: number;
  color: string;
  weight?: 'regular' | 'semibold' | 'bold';
}

export function Icon({ name, size, color, weight }: IconProps) {
  return (
    <SymbolView
      name={name as SFSymbol}
      size={size}
      tintColor={color}
      weight={weight}
      type="monochrome"
      fallback={<View style={{ width: size, height: size }} />}
    />
  );
}
