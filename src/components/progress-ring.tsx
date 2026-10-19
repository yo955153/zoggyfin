import { View } from 'react-native';

/**
 * A circular progress ring drawn with two clipped half-circle arcs (no SVG).
 * Each half shows a coloured 180° border arc, turned by the progress.
 */
export function ProgressRing({
  size,
  width = 2,
  progress,
  color,
  track,
}: {
  size: number;
  width?: number;
  progress: number;
  color: string;
  track: string;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const right = Math.min(1, p * 2);
  const left = Math.max(0, p * 2 - 1);
  const circle = { position: 'absolute' as const, top: 0, width: size, height: size, borderRadius: size / 2, borderWidth: width };
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={[circle, { left: 0, borderColor: track }]} />
      <View style={{ position: 'absolute', left: size / 2, top: 0, width: size / 2, height: size, overflow: 'hidden' }}>
        <View
          style={[
            circle,
            {
              left: -size / 2,
              borderColor: 'transparent',
              borderTopColor: color,
              borderRightColor: color,
              transform: [{ rotate: `${-135 + 180 * right}deg` }],
            },
          ]}
        />
      </View>
      <View style={{ position: 'absolute', left: 0, top: 0, width: size / 2, height: size, overflow: 'hidden' }}>
        <View
          style={[
            circle,
            {
              left: 0,
              borderColor: 'transparent',
              borderBottomColor: left > 0 ? color : 'transparent',
              borderLeftColor: left > 0 ? color : 'transparent',
              transform: [{ rotate: `${-135 + 180 * left}deg` }],
            },
          ]}
        />
      </View>
    </View>
  );
}
