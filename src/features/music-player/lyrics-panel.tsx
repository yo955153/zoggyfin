import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { activeLine, type Lyrics } from '@/player/audio/lyrics';
import { audioSession } from '@/player/audio/session';
import { usePlayerStore } from '@/player/store';
import { font, hasArabic, scriptStyle, type } from '@/theme';

import { c, spacing } from '../player/tokens';

/** The current line sits this far from the top of the panel. */
const ANCHOR = 0.35;

/**
 * Lyrics over the blurred art (design system §7.9). Synced lyrics follow the
 * song: the current line is white `title2`, the others 45 %; tapping a line
 * seeks to it. A manual scroll pauses the follow for 4 s. Plain lyrics just
 * scroll. Arabic lyrics align right.
 */
export function LyricsPanel({ lyrics }: { lyrics: Lyrics }) {
  const position = usePlayerStore((s) => s.position);
  const reduced = useReducedMotion();
  const current = activeLine(lyrics, position);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef<number[]>([]);
  const [height, setHeight] = useState(0);
  const userScrollAt = useRef(0);
  const rtl = useMemo(() => lyrics.lines.some((l) => hasArabic(l.text)), [lyrics]);

  useEffect(() => {
    if (!lyrics.synced || current < 0 || !height) return;
    if (Date.now() - userScrollAt.current < 4000) return;
    const y = offsets.current[current];
    if (y === undefined) return;
    scroll.current?.scrollTo({ y: Math.max(0, y - height * ANCHOR), animated: !reduced });
  }, [current, height, lyrics.synced, reduced]);

  const onLine = (i: number) => (e: LayoutChangeEvent) => {
    offsets.current[i] = e.nativeEvent.layout.y;
  };

  return (
    <View style={styles.root} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingTop: height * ANCHOR, paddingBottom: height * 0.6 }]}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => {
          userScrollAt.current = Date.now();
        }}
        onMomentumScrollEnd={() => {
          userScrollAt.current = Date.now();
        }}>
        {lyrics.lines.map((line, i) => {
          const active = lyrics.synced && i === current;
          const base = active ? styles.lineActive : lyrics.synced ? styles.line : styles.plain;
          const text = line.text || '♪';
          const body = (
            <Text style={[base, rtl && styles.rtl, scriptStyle(line.text, base, true)]} accessibilityRole="text">
              {text}
            </Text>
          );
          if (!lyrics.synced || line.start === null) {
            return (
              <View key={i} onLayout={onLine(i)} style={styles.lineBox}>
                {body}
              </View>
            );
          }
          const start = line.start;
          return (
            <Pressable
              key={i}
              onLayout={onLine(i)}
              style={styles.lineBox}
              onPress={() => {
                userScrollAt.current = 0;
                audioSession().seekTo(start);
              }}
              accessibilityRole="button"
              accessibilityHint="Plays from this line">
              {body}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: spacing.md },
  lineBox: { paddingVertical: spacing.xs },
  line: { ...font(type.title2), color: 'rgba(255,255,255,0.45)' },
  lineActive: { ...font(type.title2), color: c.textOnMedia },
  plain: { ...font(type.title3), color: c.textOnMediaSecondary },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
