import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSession } from '@/session';
import { useSettings } from '@/storage/settings';
import { DialogHost } from '@/ui/dialog';
import { useTheme } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Opens /live once whenever a workout arms (rowing started, or a piece was set on the PM). */
function LiveWatcher() {
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(
    () =>
      useSession.subscribe((s, prev) => {
        const wasArmed = prev.phase !== 'idle' && prev.phase !== 'finished';
        const armed = s.phase !== 'idle' && s.phase !== 'finished';
        if (armed && !wasArmed && pathRef.current !== '/live') router.push('/live');
      }),
    [],
  );
  return null;
}

export default function RootLayout() {
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const t = useTheme();

  useEffect(() => {
    // Portrait everywhere; the live screen switches to landscape itself. Unsupported on web.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    load().finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, [load]);

  if (!loaded) return null;

  // Navigators paint this behind screens mid-transition; the default light backdrop shows as a flash.
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: t.bg, card: t.surface, text: t.text, border: t.border, primary: t.accent } };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <ThemeProvider value={navTheme}>
      <SafeAreaProvider>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.bg },
            headerTintColor: t.text,
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: t.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* Singular: the watcher and the start flow may both push /live for the same workout. */}
          <Stack.Screen name="live" dangerouslySingular options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="connect" options={{ title: 'Connect', presentation: 'modal' }} />
        </Stack>
        <LiveWatcher />
        <DialogHost />
      </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
