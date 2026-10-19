import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { describeError } from '@/api/errors';
import { Icon } from '@/components/icon';
import { colors, iconSize, radius, size, spacing, type } from '@/theme';

/** Shown for every failed request. It always has a Retry button. */
export function ErrorState({
  error,
  onRetry,
  compact,
  style,
}: {
  error: unknown;
  onRetry: () => void;
  compact?: boolean;
  style?: ViewStyle;
}) {
  const d = describeError(error);
  if (compact) {
    return (
      <View style={[styles.compact, style]} accessibilityRole="alert">
        <Text style={styles.compactText} numberOfLines={2}>
          {d.title}. {d.message}
        </Text>
        <RetryButton onPress={onRetry} small />
      </View>
    );
  }
  return (
    <View style={[styles.center, style]} accessibilityRole="alert">
      <Icon name="wifi.exclamationmark" size={iconSize.state} color={colors.textSecondary} />
      <Text style={styles.title}>{d.title}</Text>
      <Text style={styles.message}>{d.message}</Text>
      <RetryButton onPress={onRetry} />
    </View>
  );
}

function RetryButton({ onPress, small }: { onPress: () => void; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.retry, small && styles.retrySmall, pressed && { opacity: 0.7 }]}>
      <Text style={styles.retryText}>Retry</Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  style,
}: {
  icon: string;
  title: string;
  message?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.center, style]}>
      <Icon name={icon} size={iconSize.state} color={colors.textTertiary} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

export function LoadingState({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.center, style]}>
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    minHeight: size.stateMinHeight,
  },
  title: { ...type.bodyStrong, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  message: { ...type.callout, color: colors.textSecondary, textAlign: 'center', maxWidth: size.messageMaxWidth },
  retry: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm2,
    borderRadius: radius.pill,
  },
  retrySmall: { marginTop: 0, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs2 },
  retryText: { ...type.buttonSmall, color: colors.text },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  compactText: { ...type.callout, color: colors.textSecondary, flex: 1 },
});
