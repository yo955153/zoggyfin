import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { type ReactNode, useEffect, useMemo } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

import { resolveScheme, useAppearance } from '@/settings/appearance';

import { darkTheme, lightTheme, ThemeContext } from './index';
import { applyWebStyles } from './web-styles';

/**
 * Picks the colour scheme (system, or the Settings override) and gives it to
 * the app and to React Navigation, so native headers and tab bars match.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const choice = useAppearance((s) => s.choice);
  const scheme = resolveScheme(choice, system);
  const theme = scheme === 'light' ? lightTheme : darkTheme;

  useEffect(() => {
    // Native views (alerts, the keyboard, menus) follow the override too.
    if (Platform.OS !== 'web') Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
  }, [choice]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.c.bg).catch(() => undefined);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const c = theme.c;
      applyWebStyles({
        bg: c.bg,
        scheme,
        accentSoft: c.accentSoft,
        glass: c.glassFallback,
        separator: c.separator,
        focus: c.focusRing,
        shadow: scheme === 'light' ? 'rgba(20,20,26,0.18)' : 'rgba(0,0,0,0.5)',
      });
      document.documentElement.style.colorScheme = scheme;
      document.body.style.backgroundColor = theme.c.bg;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.c.bg);
    }
  }, [scheme, theme]);

  const nav = useMemo(() => {
    const base = scheme === 'light' ? DefaultTheme : DarkTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: theme.c.bg,
        card: theme.c.bg,
        text: theme.c.text,
        primary: theme.c.accent,
        border: theme.c.separator,
        notification: theme.c.danger,
      },
    };
  }, [scheme, theme]);

  return (
    <ThemeContext.Provider value={theme}>
      <NavigationThemeProvider value={nav}>
        <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
        {children}
      </NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}
