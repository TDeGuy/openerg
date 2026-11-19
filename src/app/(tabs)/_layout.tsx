import { Ionicons } from '@expo/vector-icons';
import { TopTabs } from 'expo-router/js-top-tabs';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShellIcon } from '@/ui/ShellIcon';
import { useTheme } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const icon =
  (name: IconName) =>
  ({ color }: { color: unknown }) => <Ionicons name={name} color={typeof color === 'string' ? color : undefined} size={24} />;

const shellIcon = ({ color }: { color: unknown }) => <ShellIcon color={typeof color === 'string' ? color : undefined} />;

/** Swipeable tabs (a pager that follows the finger), with the bar kept at the bottom. */
export default function TabsLayout() {
  const t = useTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <TopTabs
      tabBarPosition="bottom"
      screenOptions={{
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textFaint,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border, borderTopWidth: 1, paddingBottom: bottom, elevation: 0 },
        tabBarIndicatorStyle: { height: 0 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', textTransform: 'none', margin: 0 },
        tabBarItemStyle: { paddingVertical: 6, paddingHorizontal: 0 },
        tabBarPressColor: 'transparent',
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <TopTabs.Screen name="index" options={{ title: 'Row', tabBarIcon: shellIcon }} />
      <TopTabs.Screen name="history" options={{ title: 'Logbook', tabBarIcon: icon('list-outline') }} />
      <TopTabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: icon('stats-chart-outline') }} />
      <TopTabs.Screen name="tools" options={{ title: 'Tools', tabBarIcon: icon('calculator-outline') }} />
      <TopTabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }} />
    </TopTabs>
  );
}
