import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Glass } from '@/features/player/glass';
import { toastDuration, useToastStore } from '@/lib/toast';
import { createStyles, type AppTheme, font, iconSize, motion, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { Icon } from './icon';
import { Touchable } from './touchable';

/**
 * Toasts (design system §7.14): a glass capsule at the top, under the status
 * bar (top trailing on wide windows), so it never covers the tab bar or the
 * mini player. It slides 12 pt and fades in with the `smooth` spring, fades
 * out in 160 ms, and a swipe up dismisses it.
 */
export function ToastHost() {
  const current = useToastStore((st) => st.current);
  const hide = useToastStore((st) => st.hide);
  const insets = useSafeAreaInsets();
  const l = useLayout();
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const y = useSharedValue(-12);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!current) return;
    y.set(-12);
    opacity.set(0);
    y.set(withSpring(0, motion.spring.smooth));
    opacity.set(withTiming(1, { duration: motion.duration.fast }));
    AccessibilityInfo.announceForAccessibility(current.text);
    const id = current.id;
    const t = setTimeout(() => hide(id), toastDuration(current));
    return () => clearTimeout(t);
  }, [current, hide, y, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));

  const swipe = Gesture.Pan()
    .activeOffsetY(-6)
    .onUpdate((e) => {
      y.set(Math.min(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY < -16 || e.velocityY < -400) {
        const id = current?.id;
        scheduleOnRN(hide, id);
      } else {
        y.set(withSpring(0, { ...motion.spring.smooth, velocity: e.velocityY }));
      }
    });

  if (!current) return null;
  const wide = l.bp !== 'compact';
  return (
    <View
      pointerEvents="box-none"
      style={[s.host, { top: insets.top + spacing.sm }, wide ? { right: l.gutter, alignItems: 'flex-end' } : s.centered]}>
      <GestureDetector gesture={swipe}>
        <Animated.View key={current.id} exiting={FadeOut.duration(motion.duration.fast)} style={[s.shadow, style]}>
          <Glass variant="regular" scheme="auto" style={s.capsule}>
            <View style={s.row} accessibilityLiveRegion="polite" accessibilityRole={Platform.OS === 'web' ? 'alert' : undefined}>
              {current.icon ? <Icon name={current.icon} size={scaled(iconSize.sm)} color={c.text} /> : null}
              <Text style={s.text} numberOfLines={2}>
                {current.text}
              </Text>
              {current.action ? (
                <Touchable
                  onPress={() => {
                    current.action?.onPress();
                    hide(current.id);
                  }}
                  hitSlop={8}
                  radius={8}
                  accessibilityRole="button"
                  accessibilityLabel={current.action.label}>
                  <Text style={s.action}>{current.action.label}</Text>
                </Touchable>
              ) : null}
            </View>
          </Glass>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  host: { position: 'absolute' as const, left: 0, right: 0, zIndex: 1000 },
  centered: { alignItems: 'center' as const, paddingHorizontal: spacing.lg },
  shadow: { borderRadius: radius.pill, maxWidth: scaled(sizes.toastMaxWidth), ...shadow('floating') },
  capsule: { borderRadius: radius.pill, overflow: 'hidden' as const },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    minHeight: scaled(sizes.toastMinHeight),
    paddingHorizontal: scaled(spacing.lg),
    paddingVertical: spacing.sm,
  },
  text: { ...font(type.subheadline), fontWeight: '500' as const, color: c.text, flexShrink: 1 },
  action: { ...font(type.subheadline), fontWeight: '600' as const, color: c.accent },
}));
