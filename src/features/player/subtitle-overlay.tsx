import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { cuesAt } from '@/player/vtt';
import { usePlayerStore } from '@/player/store';

import { player, spacing, textStyle, type } from './tokens';

/** Draws the selected text subtitle. Lifts above the controls when they show. */
export const SubtitleOverlay = memo(function SubtitleOverlay({ bottom }: { bottom: number }) {
  const cues = usePlayerStore((s) => s.cues);
  const position = usePlayerStore((s) => s.position);
  if (!cues?.length) return null;
  const lines = cuesAt(cues, position);
  if (!lines.length) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom }]} accessibilityLiveRegion="polite">
      {lines.map((l, i) => (
        <Text key={`${i}-${l}`} style={styles.line}>
          {l}
        </Text>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.xxxl, right: spacing.xxxl, alignItems: 'center', gap: spacing.xs },
  line: {
    ...textStyle(type.title3),
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    backgroundColor: player.subtitleBackground,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: 6,
    overflow: 'hidden',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
});
