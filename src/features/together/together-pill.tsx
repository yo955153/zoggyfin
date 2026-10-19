/**
 * The "Together" indicator in the video player: who is in the session and
 * whether the group waits. Tapping it opens the session sheet.
 */
import { Pressable, StyleSheet, Text } from 'react-native';

import { Icon } from '@/components/icon';
import { Glass } from '@/features/player/glass';
import { c, radius, spacing, textStyle, type } from '@/features/player/tokens';
import { useTogetherStore } from '@/together/store';

export function TogetherPill({ top, left, onPress }: { top: number; left: number; onPress: () => void }) {
  const label = useTogetherStore((s) => {
    if (s.syncplay.group) {
      const n = s.syncplay.group.participants.length;
      return s.waiting ? 'Together · Waiting for everyone' : `Together · ${n} ${n === 1 ? 'person' : 'people'}`;
    }
    if (s.mode !== 'nearby') return null;
    switch (s.phase.name) {
      case 'hosting': {
        const n = s.members.length + 1;
        if (s.requests.length) return `Together · ${s.requests.length} want to join`;
        return s.waiting ? 'Together · Waiting for everyone' : `Together · ${n} ${n === 1 ? 'person' : 'people'}`;
      }
      case 'syncing':
        return 'Together · Connecting';
      case 'joined':
        return s.waiting ? 'Together · Waiting for everyone' : `Together · with ${s.hostName ?? 'the host'}`;
      case 'ended':
        return 'Together · Ended';
      default:
        return null;
    }
  });
  if (!label) return null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. Open the session.`} style={[styles.wrap, { top, left }]}>
      <Glass style={styles.pill}>
        <Icon name="person.2.fill" size={14} color={c.textOnMedia} />
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    minHeight: 32,
  },
  text: { ...textStyle(type.footnote), fontWeight: '600', color: c.textOnMedia },
});
