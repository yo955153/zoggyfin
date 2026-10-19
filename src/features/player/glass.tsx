import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { dark } from '@/theme/theme';

let glassOk: boolean | null = null;
function liquidGlass(): boolean {
  if (glassOk === null) {
    try {
      glassOk = Platform.OS === 'ios' && isLiquidGlassAvailable();
    } catch {
      glassOk = false;
    }
  }
  return glassOk;
}

function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // Web has no such setting (and no glass): the solid fallback shows anyway.
    if (Platform.OS === 'web' || typeof AccessibilityInfo.isReduceTransparencyEnabled !== 'function') return;
    let alive = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => alive && setOn(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

/**
 * Glass over video (design system §3): Liquid Glass on iOS 26, the solid
 * `glassFallback` tint on web, older iOS and with Reduce Transparency.
 */
export function Glass({
  style,
  children,
  variant = 'clear',
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  variant?: 'clear' | 'regular';
}) {
  const reduce = useReduceTransparency();
  if (liquidGlass() && !reduce) {
    return (
      <GlassView style={style} glassEffectStyle={variant} colorScheme="dark" isInteractive>
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.fallback, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: dark.glassFallback },
});
